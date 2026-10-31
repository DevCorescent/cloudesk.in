"use client";

import { ArrowDownRight, ArrowUpRight, Check, Circle, Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Segmented } from "@/components/ui/overlays";
import { Card, cx, ErrorState, Notice, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { PAYMENT_LABEL, SubHeader, useMoney, useStoreCtx, useStoreQuery } from "./shared";

type Kpi = { value: number | null; change: number | null };
type Insights = {
  range: { from: string; days: number };
  kpis: { gross: Kpi; net: Kpi; orders: Kpi; aov: Kpi; units: Kpi; customers: Kpi; conversion: Kpi; grossProfit: { value: number | null; margin: number | null } };
  breakdown: { refunds: number; discounts: number; shipping: number; tax: number; collected: number };
  daily: { day: string; sales: number; orders: number }[];
  topProducts: { title: string; units: number; revenue: number }[];
  payments: { method: string; orders: number; sales: number }[];
  regions: { region: string; orders: number; sales: number }[];
  customers: { returning: number; total: number };
  backlog: { toFulfill: number; unpaid: number; inTransit: number };
  lowStock: { variantId: string; productId: string; title: string; variant: string; stock: number }[];
  funnel: { visits: number; productViews: number; addToCart: number; checkout: number; orders: number };
  abandoned: number;
};

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const pctText = (v: number | null, digits = 1) => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`);

function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="text-xs text-subtle">new</span>;
  if (Math.abs(v) < 0.0005) return <span className="text-xs text-subtle">no change</span>;
  const up = v > 0;
  return (
    <span className={cx("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", up ? "text-success" : "text-danger")}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      {Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%<span className="sr-only">{up ? " up" : " down"} vs previous period</span>
    </span>
  );
}

function KpiTile({ label, value, change, hint, tone }: { label: string; value: string; change?: number | null; hint?: string; tone?: "peach" | "lavender" | "sky" | "mint" }) {
  return (
    <Card className={cx("p-4", tone && `stat-tint tint-${tone}`)}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        {change !== undefined && <Change v={change} />}
        {hint && <span className="truncate text-xs text-subtle">{hint}</span>}
      </div>
    </Card>
  );
}

/** Single-series daily bars with a hover tooltip; the title names the series. */
function SalesChart({ data, money }: { data: Insights["daily"]; money: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.sales));
  const h = 180;
  const total = data.reduce((a, d) => a + d.sales, 0);
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Sales by day</h2>
        <span className="text-xs text-muted tabular-nums">{money(total)} total</span>
      </div>
      <div className="relative mt-4" style={{ height: h + 22 }} onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((t) => (
          <div key={t} className="absolute right-0 left-0 border-t border-border" style={{ top: h - h * t }}>
            <span className="absolute -top-4 left-0 text-[10px] text-subtle tabular-nums">{money(Math.round(max * t))}</span>
          </div>
        ))}
        <div className="absolute right-0 bottom-[22px] left-0 flex items-end gap-[2px]" style={{ height: h }} role="img" aria-label={`Sales by day: ${money(total)} over ${data.length} days`}>
          {data.map((d, i) => (
            <div key={d.day} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
              <div className="w-full rounded-t-[4px] bg-accent transition-opacity" style={{ height: d.sales ? Math.max(2, (d.sales / max) * h) : 0, opacity: hover === null || hover === i ? 1 : 0.45 }} />
            </div>
          ))}
        </div>
        <div className="absolute right-0 bottom-0 left-0 flex justify-between text-[10px] text-subtle">
          <span>{fmtDay(data[0].day)}</span>
          <span>{fmtDay(data[data.length - 1].day)}</span>
        </div>
        {hover !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 rounded-[var(--radius-md)] border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md" style={{ left: `clamp(60px, ${((hover + 0.5) / data.length) * 100}%, calc(100% - 60px))` }}>
            <p className="text-muted">{fmtDay(data[hover].day)}</p>
            <p className="font-semibold tabular-nums">{money(data[hover].sales)}</p>
            <p className="text-muted tabular-nums">
              {data[hover].orders} order{data[hover].orders === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Funnel({ f }: { f: Insights["funnel"] }) {
  const steps = [
    { label: "Store visits", v: f.visits },
    { label: "Viewed a product", v: f.productViews },
    { label: "Added to cart", v: f.addToCart },
    { label: "Reached checkout", v: f.checkout },
    { label: "Placed an order", v: f.orders },
  ];
  const max = Math.max(1, steps[0].v);
  return (
    <Card className="p-4">
      <h2 className="text-[13px] font-semibold">Conversion funnel</h2>
      <p className="mt-0.5 text-xs text-muted">Counted on your live site without cookies. Visits include all pages.</p>
      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => {
          const prev = i ? steps[i - 1].v : null;
          return (
            <li key={s.label}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span>{s.label}</span>
                <span className="tabular-nums">
                  <span className="font-medium">{s.v.toLocaleString()}</span>
                  {prev !== null && <span className="ml-2 text-xs text-muted">{prev ? `${((s.v / prev) * 100).toFixed(0)}% of previous` : "—"}</span>}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-surface-2">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.min(100, (s.v / max) * 100)}%`, minWidth: s.v ? 4 : 0 }} />
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function ShareList({ title, rows, empty }: { title: string; rows: { label: string; value: number; display: string; sub?: string }[]; empty: string }) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <Card className="p-4">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{r.label}</span>
                <span className="shrink-0 tabular-nums">
                  {r.display}
                  {r.sub && <span className="ml-1.5 text-xs text-muted">{r.sub}</span>}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-accent/80" style={{ width: `${(r.value / total) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Check = { label: string; done: boolean; href: string; hint: string };

function LaunchChecklist() {
  const { projectId, store, base, liveUrl } = useStoreCtx();
  const products = useStoreQuery<{ products: { isSample: boolean; status: string }[] }>("products");
  const payments = useStoreQuery<{ providers: { id: string; enabled: boolean }[] }>("payments");
  const shipping = useStoreQuery<{ zones: { rates: unknown[] }[] }>("shipping");
  if (!products.data || !payments.data || !shipping.data) return null;
  const real = products.data.products.filter((p) => !p.isSample && p.status === "active").length;
  const samples = products.data.products.filter((p) => p.isSample).length;
  const policiesEdited = Object.values(store.policies ?? {}).every((p) => p && !p.includes("[Edit this policy]"));
  const checks: Check[] = [
    { label: "Add your products", done: real > 0 && samples === 0, href: `${base}/products`, hint: samples ? `${samples} sample product${samples === 1 ? "" : "s"} still to replace or delete` : "Add at least one active product" },
    { label: "Turn on a way to get paid", done: payments.data.providers.some((p) => p.enabled), href: `${base}/payments`, hint: "Razorpay, Stripe, PayPal, UPI or cash on delivery" },
    { label: "Set delivery rates", done: shipping.data.zones.some((z) => z.rates.length > 0), href: `${base}/shipping`, hint: "Where you ship and what it costs" },
    { label: "Write your store policies", done: policiesEdited, href: `${base}/settings`, hint: "Shipping, refunds, privacy and terms" },
    { label: "Add a contact email", done: !!store.email, href: `${base}/settings`, hint: "For order notifications and customer replies" },
    { label: "Publish your site", done: !!liveUrl, href: `/projects/${projectId}/deployments`, hint: "Deploy to production to open the store" },
  ];
  const done = checks.filter((c) => c.done).length;
  if (done === checks.length) return null;
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Get ready to sell</h2>
        <span className="text-xs text-muted tabular-nums">
          {done} of {checks.length} done
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-surface-2">
        <div className="h-1.5 rounded-full bg-success" style={{ width: `${(done / checks.length) * 100}%` }} />
      </div>
      <ul className="mt-3 grid gap-1 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.label}>
            <Link href={c.href} className="flex items-start gap-2.5 rounded-[var(--radius-md)] p-2 hover:bg-surface-2">
              {c.done ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-subtle" aria-label="To do" />}
              <span className="min-w-0">
                <span className={cx("block text-[13px]", c.done ? "text-muted line-through" : "font-medium")}>{c.label}</span>
                {!c.done && <span className="block text-xs text-muted">{c.hint}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function StoreOverview() {
  const { base, can } = useStoreCtx();
  const money = useMoney();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const q = useStoreQuery<Insights>(`insights?days=${days}`);
  const m = (n: number) => money(n);

  return (
    <div className="space-y-5">
      <SubHeader
        title="Overview"
        description="How your store is doing, compared with the previous period."
        actions={<Segmented label="Date range" value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />}
      />
      <LaunchChecklist />
      {q.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          {(q.data.backlog.toFulfill > 0 || q.data.backlog.unpaid > 0) && can("store:orders") && (
            <Notice
              tone="accent"
              title="Needs your attention"
              action={
                <Link href={`${base}/orders`} className="text-[13px] font-medium text-accent hover:underline">
                  Go to orders →
                </Link>
              }
            >
              {[q.data.backlog.toFulfill && `${q.data.backlog.toFulfill} order${q.data.backlog.toFulfill === 1 ? "" : "s"} to pack and ship`, q.data.backlog.unpaid && `${q.data.backlog.unpaid} bank/UPI order${q.data.backlog.unpaid === 1 ? "" : "s"} awaiting payment`, q.data.backlog.inTransit && `${q.data.backlog.inTransit} in transit`].filter(Boolean).join(" · ")}
            </Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile tone="peach" label="Total sales" value={m(q.data.kpis.gross.value ?? 0)} change={q.data.kpis.gross.change} />
            <KpiTile tone="lavender" label="Orders" value={(q.data.kpis.orders.value ?? 0).toLocaleString()} change={q.data.kpis.orders.change} />
            <KpiTile tone="sky" label="Average order value" value={m(q.data.kpis.aov.value ?? 0)} change={q.data.kpis.aov.change} />
            <KpiTile tone="mint" label="Conversion rate" value={pctText(q.data.kpis.conversion.value, 2)} hint="orders ÷ visits" />
            <KpiTile label="Net sales" value={m(q.data.kpis.net.value ?? 0)} change={q.data.kpis.net.change} hint="after refunds" />
            <KpiTile label="Gross profit" value={q.data.kpis.grossProfit.value === null ? "—" : m(q.data.kpis.grossProfit.value)} hint={q.data.kpis.grossProfit.margin === null ? "add product costs to see profit" : `${pctText(q.data.kpis.grossProfit.margin)} margin`} />
            <KpiTile label="Units sold" value={(q.data.kpis.units.value ?? 0).toLocaleString()} change={q.data.kpis.units.change} />
            <KpiTile label="Customers" value={(q.data.kpis.customers.value ?? 0).toLocaleString()} change={q.data.kpis.customers.change} hint={q.data.customers.total ? `${q.data.customers.returning} returning` : undefined} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <SalesChart data={q.data.daily} money={m} />
            <Card className="p-4">
              <h2 className="text-[13px] font-semibold">Where the money went</h2>
              <dl className="mt-3 space-y-2 text-[13px]">
                {[
                  ["Collected", q.data.breakdown.collected, "paid orders"],
                  ["Discounts given", q.data.breakdown.discounts, ""],
                  ["Shipping charged", q.data.breakdown.shipping, ""],
                  ["Tax collected", q.data.breakdown.tax, ""],
                  ["Refunded", q.data.breakdown.refunds, ""],
                ].map(([k, v, h]) => (
                  <div key={k as string} className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted">
                      {k}
                      {h && <span className="ml-1 text-xs text-subtle">({h})</span>}
                    </dt>
                    <dd className="font-medium tabular-nums">{m(v as number)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 p-2.5 text-xs text-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Cancelled orders are excluded. Sales include shipping and tax.
              </div>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Funnel f={q.data.funnel} />
            <Card className="p-4">
              <h2 className="text-[13px] font-semibold">Top products</h2>
              {q.data.topProducts.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">No sales in this period yet.</p>
              ) : (
                <table className="mt-2 w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1.5 font-medium">Product</th>
                      <th className="py-1.5 text-right font-medium">Units</th>
                      <th className="py-1.5 text-right font-medium">Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {q.data.topProducts.map((p) => (
                      <tr key={p.title}>
                        <td className="max-w-0 truncate py-2 pr-2">{p.title}</td>
                        <td className="py-2 text-right tabular-nums">{p.units}</td>
                        <td className="py-2 text-right tabular-nums">{m(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <ShareList title="Payment methods" empty="No orders yet." rows={q.data.payments.map((p) => ({ label: PAYMENT_LABEL[p.method] ?? p.method, value: p.sales, display: m(p.sales), sub: `${p.orders}` }))} />
            <ShareList title="Top locations" empty="No orders yet." rows={q.data.regions.map((r) => ({ label: r.region || "Unknown", value: r.sales, display: m(r.sales), sub: `${r.orders}` }))} />
            <Card className="p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[13px] font-semibold">Low stock</h2>
                <Link href={`${base}/inventory`} className="text-xs text-accent hover:underline">
                  Inventory →
                </Link>
              </div>
              {q.data.lowStock.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">Everything is well stocked.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border text-[13px]">
                  {q.data.lowStock.map((l) => (
                    <li key={l.variantId} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`${base}/products/${l.productId}`} className="min-w-0 truncate hover:underline">
                        {l.title}
                        {l.variant !== "Default" && <span className="text-muted"> · {l.variant}</span>}
                      </Link>
                      <span className={cx("shrink-0 text-xs font-medium tabular-nums", l.stock <= 0 ? "text-danger" : "text-warning")}>{l.stock <= 0 ? "Out of stock" : `${l.stock} left`}</span>
                    </li>
                  ))}
                </ul>
              )}
              {q.data.abandoned > 0 && can("store:orders") && (
                <Link href={`${base}/abandoned`} className="mt-3 block rounded-[var(--radius-md)] bg-surface-2 p-2.5 text-xs hover:bg-surface-3">
                  <span className="font-medium">{q.data.abandoned} abandoned cart{q.data.abandoned === 1 ? "" : "s"}</span> <span className="text-muted">— follow up with shoppers who agreed to emails →</span>
                </Link>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
