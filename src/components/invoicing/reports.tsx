"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CreditCard, Download, FilePlus2, FileText, Hourglass, Palette, ScrollText, Settings2, Store, Wallet } from "lucide-react";
import { useSession } from "@/components/shell/session-context";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Segmented } from "@/components/ui/overlays";
import { ButtonLink, Card, ErrorState, Input, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { PAY_METHOD_LABEL } from "@/lib/invoicing/model";
import { SubHeader } from "../store/shared";
import { fmtDate, invApi, money, useInv, useInvQuery } from "./shared";

type Report = {
  range: { from: string; to: string };
  currency: string;
  mixedCurrencies: boolean;
  kpis: { invoiced: number; credited: number; net: number; collected: number; outstanding: number; overdue: number; overdueCount: number; invoiceCount: number; avgDaysToPay: number | null; avgInvoice: number | null };
  months: { month: string; invoiced: number; collected: number }[];
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90: number };
  topClients: { name: string; invoiced: number; paid: number; balance: number; count: number }[];
  quotes: { count: number; value: number; won: number; wonValue: number; declined: number; open: number; conversion: number | null };
  taxes: { label: string; taxable: number; amount: number }[];
  gst: { cgst: number; sgst: number; igst: number; other: number };
  methods: { method: string; amount: number; count: number }[];
  statusCounts: Record<string, number>;
  /** Sales from the linked online store and till, when there is one. */
  store: StoreSales | null;
};

type StoreSales = { projectId: string; name: string; currency: string; gross: number; refunds: number; net: number; tax: number; orders: number; online: { orders: number; net: number }; counter: { orders: number; net: number }; months: { month: string; net: number }[] };

/** Income from the store next to invoices, plus the combined total when they share a currency. */
function StoreSalesSection({ r }: { r: Report }) {
  const { boot, projectId, apiBase } = useInv();
  const qc = useQueryClient();
  const unlink = useMutation({ mutationFn: () => api(invApi(apiBase, "store-link"), { method: "PUT", body: { projectId: null } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["invoicing", projectId] }) });
  const st = r.store;
  if (!st) return boot.scope?.kind === "book" ? <StoreLinkHint /> : null;
  const m = (n: number) => money(n, st.currency);
  const same = st.currency === r.currency;
  return (
    <section className="tint-card tint-peach rounded-[22px] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-semibold"><Store className="size-4 text-[var(--t-ink)]" /> {st.name} · store sales</p>
          <p className="mt-0.5 text-[12px] text-muted">Paid online orders and counter sales in this period, after refunds — straight from your store, nothing to enter twice.</p>
          {boot.scope?.kind === "book" && <button type="button" className="mt-1 text-[11.5px] text-muted underline-offset-2 hover:underline" onClick={() => unlink.mutate()}>Unlink this store</button>}
        </div>
        {same && (
          <div className="text-right">
            <p className="text-[11.5px] font-semibold tracking-[0.12em] text-muted uppercase">All income</p>
            <p className="text-[24px] leading-tight font-semibold tabular-nums">{m(st.net + r.kpis.collected)}</p>
            <p className="text-[11.5px] text-muted">{m(r.kpis.collected)} invoices + {m(st.net)} store</p>
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Store sales (net)", m(st.net), `${st.orders} order${st.orders === 1 ? "" : "s"}${st.refunds ? ` · ${m(st.refunds)} refunded` : ""}`],
          ["Online", m(st.online.net), `${st.online.orders} order${st.online.orders === 1 ? "" : "s"}`],
          ["At the counter", m(st.counter.net), `${st.counter.orders} sale${st.counter.orders === 1 ? "" : "s"}`],
          ["Tax collected in store", m(st.tax), "From store invoices"],
        ].map(([l, v, h]) => (
          <div key={l} className="rounded-[14px] bg-[var(--surface-solid)]/70 p-3 ring-1 ring-fg/[0.05]">
            <p className="text-[11.5px] text-muted">{l}</p>
            <p className="mt-0.5 text-[18px] font-semibold tabular-nums">{v}</p>
            <p className="text-[11px] text-muted">{h}</p>
          </div>
        ))}
      </div>
      {!same && <p className="mt-3 text-[11.5px] text-warning">The store sells in {st.currency} and these books use {r.currency}, so they&apos;re shown side by side rather than added together.</p>}
    </section>
  );
}

/** Standalone books: link a store so its sales appear here. */
function StoreLinkHint() {
  const { projectId, apiBase } = useInv();
  const qc = useQueryClient();
  const q = useInvQuery<{ kind: string; linked: string | null; choices: { id: string; name: string; currency: string }[] }>("store-link");
  const link = useMutation({ mutationFn: (id: string) => api(invApi(apiBase, "store-link"), { method: "PUT", body: { projectId: id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["invoicing", projectId] }) });
  if (!q.data?.choices.length) return null;
  return (
    <section className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-4">
      <p className="flex items-center gap-2 text-[13px]"><Store className="size-4 text-muted" /> See your store&apos;s sales here too — online orders and counter sales, next to your invoices.</p>
      <select aria-label="Link a store" className="h-9 rounded-full border border-border bg-surface px-3 text-[13px]" defaultValue="" onChange={(e) => e.target.value && link.mutate(e.target.value)} disabled={link.isPending}>
        <option value="" disabled>Link a store…</option>
        {q.data.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </section>
  );
}

/** Indian financial year (April–March) containing a date. */
function fyRange(today: string, offset = 0) {
  const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0) + offset;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}
function presets(today: string) {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastOf = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return {
    month: { label: "This month", from: `${y}-${pad(m)}-01`, to: today },
    last: { label: "Last month", from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${lastOf(py, pm)}` },
    fy: { label: "This financial year", ...fyRange(today), },
    lastfy: { label: "Last financial year", ...fyRange(today, -1) },
    year: { label: "This calendar year", from: `${y}-01-01`, to: today },
  };
}

type Tint = "peach" | "lavender" | "mint" | "sky" | "butter" | "rose";

/** A figure on a softly tinted card. */
function Kpi({ label, value, hint, tint, icon }: { label: string; value: string; hint?: ReactNode; tint: Tint; icon: ReactNode }) {
  return (
    <div className={cx("tint-card rounded-[20px] p-4", `tint-${tint}`)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted">{label}</p>
        <span className="tint-chip grid size-7 place-items-center rounded-full [&_svg]:size-3.5">{icon}</span>
      </div>
      <p className="mt-2 truncate text-[24px] font-semibold tracking-[-0.025em] tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });

/** Invoiced vs collected per month: two series on one axis, legend + hover details. */
function MonthsChart({ data, currency }: { data: Report["months"]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.invoiced, d.collected]));
  const h = 180;
  const m = (n: number) => money(n, currency).replace(/\.00$/, "");
  const sum = (k: "invoiced" | "collected") => data.reduce((a, d) => a + d[k], 0);
  const series = [
    { key: "invoiced" as const, label: "Invoiced", color: "var(--viz-1)" },
    { key: "collected" as const, label: "Collected", color: "var(--viz-2)" },
  ];
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Invoiced and collected, last 12 months</h2>
        <ul className="flex gap-4 text-[12px]" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              <span className="text-muted">{s.label}</span>
              <span className="font-medium tabular-nums">{m(sum(s.key))}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative mt-5" style={{ height: h + 22 }} onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((t) => (
          <div key={t} className="absolute right-0 left-0 border-t border-border" style={{ top: h - h * t }}>
            <span className="absolute -top-4 left-0 text-[10px] text-subtle tabular-nums">{m(Math.round(max * t))}</span>
          </div>
        ))}
        <div className="absolute right-0 bottom-[22px] left-0 flex items-end gap-2" style={{ height: h }} role="img" aria-label={`Invoiced ${m(sum("invoiced"))} and collected ${m(sum("collected"))} over 12 months`}>
          {data.map((d, i) => (
            <div key={d.month} className="relative flex h-full flex-1 items-end justify-center gap-[2px]" onMouseEnter={() => setHover(i)}>
              {series.map((s) => (
                <div key={s.key} className="w-full max-w-[18px] rounded-t-[4px] transition-opacity" style={{ background: s.color, height: d[s.key] ? Math.max(2, (d[s.key] / max) * h) : 0, opacity: hover === null || hover === i ? 1 : 0.4 }} />
              ))}
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-2 min-w-36 rounded-[10px] border border-border bg-surface-solid px-3 py-2 text-[12px] shadow-lg" style={{ left: i > data.length / 2 ? "auto" : 0, right: i > data.length / 2 ? 0 : "auto" }}>
                  <p className="font-semibold">{new Date(`${d.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</p>
                  {series.map((s) => (
                    <p key={s.key} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span>
                      <span className="tabular-nums">{m(d[s.key])}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="absolute right-0 bottom-0 left-0 flex gap-2 text-[10px] text-subtle">
          {data.map((d, i) => <span key={d.month} className="flex-1 text-center">{i % 2 === data.length % 2 ? monthLabel(d.month) : ""}</span>)}
        </div>
      </div>
    </Card>
  );
}

/** One series of horizontal bars with the value written on each. */
function BarList({ title, rows, currency, empty }: { title: string; rows: { label: string; value: number; sub?: string }[]; currency: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-[13px] font-semibold">{title}</h2>
      {!rows.some((r) => r.value) ? (
        <p className="text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-2.5">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate">{r.label}{r.sub && <span className="ml-1.5 text-[11px] text-muted">{r.sub}</span>}</span>
                <span className="shrink-0 font-medium tabular-nums">{money(r.value, currency)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: "var(--viz-1)" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReportBody({ r }: { r: Report }) {
  const c = r.currency;
  const m = (n: number) => money(n, c);
  return (
    <div className="grid gap-4">
      <StoreSalesSection r={r} />
      {r.mixedCurrencies && <p className="rounded-[12px] bg-warning/10 px-3 py-2 text-[12px]">You have documents in more than one currency. Totals add them as-is, without converting — use the CSV export to separate them.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tint="sky" icon={<FileText />} label="Invoiced" value={m(r.kpis.invoiced)} hint={`${r.kpis.invoiceCount} invoice${r.kpis.invoiceCount === 1 ? "" : "s"}${r.kpis.credited ? ` · ${m(r.kpis.credited)} credited` : ""}`} />
        <Kpi tint="mint" icon={<Wallet />} label="Collected" value={m(r.kpis.collected)} hint="Payments recorded in this period" />
        <Kpi tint="butter" icon={<Hourglass />} label="Outstanding now" value={m(r.kpis.outstanding)} hint={r.kpis.avgDaysToPay !== null ? `Paid in ${r.kpis.avgDaysToPay} days on average` : "Across all open invoices"} />
        <Kpi tint="rose" icon={<AlarmClock />} label="Overdue now" value={m(r.kpis.overdue)} hint={`${r.kpis.overdueCount} invoice${r.kpis.overdueCount === 1 ? "" : "s"} past due`} />
      </div>
      <MonthsChart data={r.months} currency={c} />
      <div className="grid gap-4 lg:grid-cols-2">
        <BarList
          title="What you're owed, by age"
          currency={c}
          empty="Nothing outstanding."
          rows={[
            { label: "Not yet due", value: r.aging.current },
            { label: "1–30 days late", value: r.aging.d1_30 },
            { label: "31–60 days late", value: r.aging.d31_60 },
            { label: "61–90 days late", value: r.aging.d61_90 },
            { label: "Over 90 days late", value: r.aging.d90 },
          ]}
        />
        <BarList title="Top clients by value invoiced" currency={c} empty="No invoices in this period." rows={r.topClients.map((t) => ({ label: t.name, value: t.invoiced, sub: t.balance ? `${m(t.balance)} due` : "settled" }))} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="text-[13px] font-semibold">Quotations</h2>
          {!r.quotes.count ? (
            <p className="mt-2 text-[13px] text-muted">No quotations issued in this period.</p>
          ) : (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
              <div><dt className="text-muted">Win rate</dt><dd className="text-[20px] font-semibold tabular-nums">{r.quotes.conversion === null ? "—" : `${Math.round(r.quotes.conversion * 100)}%`}</dd></div>
              <div><dt className="text-muted">Won value</dt><dd className="text-[20px] font-semibold tabular-nums">{m(r.quotes.wonValue)}</dd></div>
              <div><dt className="text-muted">Sent</dt><dd className="tabular-nums">{r.quotes.count} · {m(r.quotes.value)}</dd></div>
              <div><dt className="text-muted">Open / declined</dt><dd className="tabular-nums">{r.quotes.open} / {r.quotes.declined}</dd></div>
            </dl>
          )}
        </Card>
        <BarList title="Payments by method" currency={c} empty="No payments recorded in this period." rows={r.methods.map((x) => ({ label: PAY_METHOD_LABEL[x.method as keyof typeof PAY_METHOD_LABEL] ?? x.method, value: x.amount, sub: `${x.count}` }))} />
        <Card className="p-4">
          <h2 className="text-[13px] font-semibold">Tax on invoices</h2>
          {!r.taxes.length ? (
            <p className="mt-2 text-[13px] text-muted">No tax charged in this period.</p>
          ) : (
            <table className="mt-2 w-full text-[13px]">
              <thead><tr className="text-left text-[11px] text-muted"><th className="py-1 font-medium">Tax</th><th className="py-1 text-right font-medium">Taxable</th><th className="py-1 text-right font-medium">Amount</th></tr></thead>
              <tbody>
                {r.taxes.map((t) => <tr key={t.label} className="border-t border-border/60"><td className="py-1.5">{t.label}</td><td className="py-1.5 text-right tabular-nums">{m(t.taxable)}</td><td className="py-1.5 text-right tabular-nums">{m(t.amount)}</td></tr>)}
              </tbody>
              <tfoot>
                {(r.gst.cgst || r.gst.sgst || r.gst.igst) > 0 && (
                  <tr className="border-t border-border text-[12px]"><td className="pt-2" colSpan={3}>CGST {m(r.gst.cgst)} · SGST {m(r.gst.sgst)} · IGST {m(r.gst.igst)}{r.gst.other ? ` · other ${m(r.gst.other)}` : ""}</td></tr>
                )}
              </tfoot>
            </table>
          )}
          <p className="mt-2 text-[11px] text-muted">Credit notes are subtracted. Check with your accountant before filing.</p>
        </Card>
      </div>
    </div>
  );
}

function greeting(name: string) {
  const h = new Date().getHours();
  return `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}${name ? `, ${name}` : ""}`;
}

export function InvoicingOverview() {
  const { base, boot } = useInv();
  const { user } = useSession();
  const fy = fyRange(boot.today);
  const q = useInvQuery<Report>(`reports?from=${fy.from}&to=${boot.today}`);
  const s = boot.settings;
  const r = q.data;
  const m = (n: number) => money(n, r?.currency ?? s.currency);
  const setup = [
    { done: !!(s.saved && s.business.name && (s.business.address.line1 || s.business.address.city)), title: "Add your business details", sub: "Name, address, GSTIN, logo — printed on every document", href: `${base}/settings`, icon: <Settings2 className="size-4" />, tint: "lavender" as Tint },
    { done: !!(s.payment.upiId || s.payment.accountNumber), title: "Add how clients pay you", sub: "Bank details and UPI — a pay-by-QR code appears on invoices", href: `${base}/settings`, icon: <Wallet className="size-4" />, tint: "mint" as Tint },
    { done: boot.templates.length > 1 || boot.templates.some((t) => t.source !== "prebuilt"), title: "Pick a design or upload yours", sub: "8 professional templates, or match the invoice you use today", href: `${base}/templates`, icon: <Palette className="size-4" />, tint: "peach" as Tint },
    { done: !!r?.kpis.invoiceCount, title: "Send your first invoice", sub: "Share it by link, email, WhatsApp, SMS or PDF", href: `${base}/invoices/new`, icon: <FilePlus2 className="size-4" />, tint: "sky" as Tint },
  ];
  const left = setup.filter((x) => !x.done);
  return (
    <div className="grid gap-5">
      <section className="fin-hero rounded-[28px] p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-muted">{greeting(user.name.split(" ")[0] ?? "")}</p>
            <p className="mt-3 text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">You&apos;re owed</p>
            <p className="mt-1 text-[clamp(2.2rem,5vw,3.4rem)] leading-none font-semibold tracking-[-0.035em] tabular-nums">{r ? m(r.kpis.outstanding) : "—"}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
              {r && r.kpis.overdue > 0 && <span className="tint-rose tint-chip rounded-full px-2.5 py-1 font-medium">{m(r.kpis.overdue)} overdue</span>}
              {r && <span className="tint-mint tint-chip rounded-full px-2.5 py-1 font-medium">{m(r.kpis.collected)} collected this financial year</span>}
              {r?.kpis.avgDaysToPay != null && <span className="tint-sky tint-chip rounded-full px-2.5 py-1 font-medium">Paid in {r.kpis.avgDaysToPay} days on average</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${base}/invoices`} icon={<CreditCard className="size-3.5" />}>Record a payment</ButtonLink>
            <ButtonLink href={`${base}/quotes/new`} icon={<ScrollText className="size-3.5" />}>New quotation</ButtonLink>
            <ButtonLink href={`${base}/invoices/new`} variant="primary" icon={<FilePlus2 className="size-3.5" />}>New invoice</ButtonLink>
          </div>
        </div>
      </section>
      {left.length > 0 && (
        <section className="glass-card rounded-[22px] p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">Get set up</h2>
            <span className="text-xs text-muted tabular-nums">{setup.length - left.length} of {setup.length} done</span>
          </div>
          <ul className="grid-cols-2 mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {setup.map((x) => (
              <li key={x.title}>
                <Link href={x.href} className={cx("tint-card lx-card flex h-full items-start gap-3 rounded-[16px] p-3", `tint-${x.tint}`, x.done && "opacity-55")}>
                  <span className={cx("grid size-8 shrink-0 place-items-center rounded-full", x.done ? "bg-success text-white" : "tint-chip")}>{x.icon}</span>
                  <span><span className={cx("block text-[13px] font-medium", x.done && "line-through")}>{x.title}</span><span className="block text-[12px] text-muted">{x.sub}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div>
        <p className="mb-3 text-[12px] text-muted">This financial year · {fmtDate(fy.from)} – today</p>
        {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !r ? <Skeleton className="h-96" /> : <ReportBody r={r} />}
      </div>
    </div>
  );
}

export function ReportsView() {
  const { apiBase, boot } = useInv();
  const p = useMemo(() => presets(boot.today), [boot.today]);
  const [preset, setPreset] = useState<keyof typeof p | "custom">("fy");
  const [custom, setCustom] = useState({ from: p.fy.from, to: boot.today });
  const r = preset === "custom" ? custom : p[preset];
  const to = r.to > boot.today ? boot.today : r.to;
  const q = useInvQuery<Report>(`reports?from=${r.from}&to=${to}`);
  const exp = (kind: string) => `${invApi(apiBase, `export/${kind}`)}?from=${r.from}&to=${to}`;
  return (
    <div>
      <SubHeader title="Reports" description="Sales, collections, receivables and tax — from issued documents and recorded payments only." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="Period" value={preset} onChange={setPreset} options={[...Object.entries(p).map(([k, v]) => ({ value: k as keyof typeof p, label: v.label })), { value: "custom" as const, label: "Custom" }]} />
        {preset === "custom" && (
          <span className="flex items-center gap-1.5">
            <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="!h-8 !w-auto text-[13px]" aria-label="From" />
            <span className="text-muted">to</span>
            <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="!h-8 !w-auto text-[13px]" aria-label="To" />
          </span>
        )}
      </div>
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <span className="mr-1 text-[13px] font-medium">Download for {fmtDate(r.from)} – {fmtDate(to)}:</span>
        {[["documents", "Invoice register"], ["tax", "GST / tax report"], ["payments", "Payments received"], ["clients", "Client list"]].map(([k, l]) => (
          <a key={k} href={exp(k)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> {l}</a>
        ))}
        <span className="text-[11px] text-muted">CSV, opens in Excel, Google Sheets or Tally import tools</span>
      </Card>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-96" /> : <ReportBody r={q.data} />}
    </div>
  );
}

type Payment = { id: string; amount: number; method: string; paidOn: string; reference: string; note: string; documentId: string; number: string; currency: string; client: string };

export function PaymentsView() {
  const { apiBase, base, boot } = useInv();
  const fy = fyRange(boot.today);
  const [range, setRange] = useState({ from: fy.from, to: boot.today });
  const q = useInvQuery<{ payments: Payment[] }>(`payments?from=${range.from}&to=${range.to}`);
  const cur = boot.settings.currency;
  const total = (q.data?.payments ?? []).filter((p) => p.currency === cur).reduce((a, p) => a + p.amount, 0);
  return (
    <div>
      <SubHeader
        title="Payments"
        description="Money received against invoices. Record a payment from the invoice itself."
        actions={<a href={`${invApi(apiBase, "export/payments")}?from=${range.from}&to=${range.to}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> CSV</a>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px]">
        <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="!h-8 !w-auto" aria-label="From" />
        <span className="text-muted">to</span>
        <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="!h-8 !w-auto" aria-label="To" />
        <span className="ml-auto font-medium tabular-nums">{money(total, cur)} received</span>
      </div>
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-64" />
      ) : !q.data.payments.length ? (
        <Card className="p-10 text-center text-[13px] text-muted">No payments recorded in this period. Open an invoice and choose “Record payment” when money arrives.</Card>
      ) : (
        <div className="glass-card overflow-x-auto rounded-[var(--radius-xl)]">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="border-b border-border text-left text-[12px] text-muted"><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Invoice</th><th className="px-4 py-2.5 font-medium">Client</th><th className="px-4 py-2.5 font-medium">Method</th><th className="px-4 py-2.5 text-right font-medium">Amount</th></tr></thead>
            <tbody>
              {q.data.payments.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 tabular-nums">{fmtDate(p.paidOn)}</td>
                  <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`${base}/invoices/${p.documentId}`}>{p.number}</Link></td>
                  <td className="px-4 py-3">{p.client}</td>
                  <td className="px-4 py-3 text-muted">{PAY_METHOD_LABEL[p.method as keyof typeof PAY_METHOD_LABEL] ?? p.method}{p.reference && ` · ${p.reference}`}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{money(p.amount, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
