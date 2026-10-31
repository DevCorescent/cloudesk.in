"use client";

// Reports for any date range: sales, covers, GST by rate (CGST/SGST), payment
// methods, order types, busiest hours, days, categories, dishes, staff, and
// loss prevention (cancellations, discounts, comps, cash paid out). Every
// table can be downloaded as CSV for the accountant.
import { Download, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { neutralizeFormula } from "@/lib/data/model";
import { Badge, Button, cx, EmptyState, Input, PageHeader, Skeleton } from "@/components/ui/primitives";
import { METHOD_LABEL, SOURCE_LABEL } from "./bill";
import { Stat, useHQuery, useMoney } from "./shared";

type Report = {
  from: string;
  to: string;
  totals: { gross: number; discounts: number; comps: number; net: number; service: number; delivery: number; tax: number; cgst: number; sgst: number; tips: number; roundOff: number; total: number; bills: number; covers: number; average: number; perCover: number };
  gst: { rate: number; taxable: number; tax: number; cgst: number; sgst: number }[];
  methods: Record<string, number>;
  types: Record<string, { bills: number; total: number }>;
  hours: { hour: number; bills: number; total: number }[];
  days: { day: string; bills: number; total: number; covers: number }[];
  categories: { name: string; qty: number; revenue: number }[];
  items: { name: string; category: string; qty: number; revenue: number }[];
  staff: { name: string; bills: number; total: number }[];
  cancelled: { count: number };
  events: { id: string; kind: string; staffName: string; approvedBy: string; amount: number; detail: string; createdAt: string }[];
  eventTotals: { kind: string; count: number; amount: number }[];
  feedback: { count: number; average: number };
};

const ist = (d = 0) => new Date(Date.now() + 5.5 * 3600_000 + d * 86_400_000).toISOString().slice(0, 10);
const PRESETS: [string, () => [string, string]][] = [
  ["Today", () => [ist(), ist()]],
  ["Yesterday", () => [ist(-1), ist(-1)]],
  ["Last 7 days", () => [ist(-6), ist()]],
  ["Last 30 days", () => [ist(-29), ist()]],
  ["This month", () => [`${ist().slice(0, 8)}01`, ist()]],
];
const EVENT_LABEL: Record<string, string> = { void: "Cancelled", discount: "Discount", comp: "On the house", pay_out: "Cash paid out", pay_in: "Cash paid in", transfer: "Moved table", merge: "Merged", split: "Split" };

/** Downloads rows as a CSV file. */
function csv(name: string, header: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => (typeof v === "number" ? String(v) : `"${neutralizeFormula(v).replace(/"/g, '""')}"`);
  const blob = new Blob([[header, ...rows].map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** One-series bars with a hover value; the numbers are also in the table beside them. */
function Bars({ data, label }: { data: { key: string; value: number; title: string }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={label} className="flex h-36 items-end gap-[3px]">
      {data.map((d) => (
        <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end">
          <span className="w-full rounded-t-[4px] bg-[var(--accent)] opacity-80 transition-opacity group-hover:opacity-100" style={{ height: `${Math.max(d.value ? 3 : 0, (d.value / max) * 100)}%` }} />
          <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-[8px] bg-fg px-2 py-1 text-[11px] whitespace-nowrap text-bg group-hover:block">{d.title}</span>
        </div>
      ))}
    </div>
  );
}

const Card = ({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={cx("rounded-[20px] border border-border bg-surface p-4 shadow-sm", className)}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

export function ReportsView() {
  const money = useMoney();
  const [range, setRange] = useState<[string, string]>(PRESETS[0][1]());
  const [preset, setPreset] = useState("Today");
  const q = useHQuery<Report>(`reports?from=${range[0]}&to=${range[1]}`);
  const r = q.data;
  const rupees = (n: number) => (n / 100).toFixed(2);
  return (
    <div>
      <PageHeader title="Reports" description="Every number comes from settled bills in the range (venue time). Download any table as CSV." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {PRESETS.map(([l, f]) => (
          <button key={l} type="button" onClick={() => (setRange(f()), setPreset(l))} aria-pressed={preset === l} className={cx("h-8 rounded-full border px-3.5 text-[13px] font-medium", preset === l ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
            {l}
          </button>
        ))}
        <span className="ml-1 flex items-center gap-1.5">
          <Input type="date" aria-label="From" value={range[0]} onChange={(e) => e.target.value && (setRange([e.target.value, range[1] < e.target.value ? e.target.value : range[1]]), setPreset(""))} className="!h-8 w-40" />
          <span className="text-muted">→</span>
          <Input type="date" aria-label="To" value={range[1]} min={range[0]} onChange={(e) => e.target.value && (setRange([range[0], e.target.value]), setPreset(""))} className="!h-8 w-40" />
        </span>
      </div>
      {!r ? (
        <Skeleton className="h-[60vh] rounded-[22px]" />
      ) : !r.totals.bills ? (
        <EmptyState title="No settled bills in this range" description="Pick another range, or settle a bill on the POS." />
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Sales" value={money(r.totals.total)} sub={`${r.totals.bills} bills`} />
            <Stat label="Net food & drink" value={money(r.totals.net)} sub="after discounts, before tax" />
            <Stat label="Average bill" value={money(r.totals.average)} />
            <Stat label="Covers" value={r.totals.covers} sub={r.totals.covers ? `${money(r.totals.perCover)} a head` : "not recorded"} />
            <Stat label="Rating" value={r.feedback.count ? `${r.feedback.average} ★` : "—"} sub={`${r.feedback.count} reviews`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Busiest hours">
              <Bars label="Sales by hour of the day" data={r.hours.map((h) => ({ key: String(h.hour), value: h.total, title: `${h.hour}:00 · ${money(h.total)} · ${h.bills} bills` }))} />
              <div className="mt-1 flex justify-between text-[10.5px] text-subtle">
                <span>12 am</span>
                <span>6 am</span>
                <span>12 pm</span>
                <span>6 pm</span>
                <span>11 pm</span>
              </div>
            </Card>
            <Card title="Bill breakdown" action={<Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => csv(`summary-${r.from}-${r.to}.csv`, ["Line", "Amount"], [["Gross", rupees(r.totals.gross)], ["On the house", rupees(r.totals.comps)], ["Discounts", rupees(r.totals.discounts)], ["Net", rupees(r.totals.net)], ["Service charge", rupees(r.totals.service)], ["Delivery", rupees(r.totals.delivery)], ["CGST", rupees(r.totals.cgst)], ["SGST", rupees(r.totals.sgst)], ["Tips", rupees(r.totals.tips)], ["Round off", rupees(r.totals.roundOff)], ["Total", rupees(r.totals.total)]])}>CSV</Button>}>
              <dl className="grid gap-1 text-[13px]">
                {(
                  [
                    ["Gross (menu prices)", r.totals.gross],
                    ["On the house", -r.totals.comps],
                    ["Discounts", -r.totals.discounts],
                    ["Service charge", r.totals.service],
                    ["Delivery", r.totals.delivery],
                    ["CGST", r.totals.cgst],
                    ["SGST", r.totals.sgst],
                    ["Tips", r.totals.tips],
                    ["Round off", r.totals.roundOff],
                  ] as [string, number][]
                )
                  .filter(([, v]) => v !== 0)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between text-muted">
                      <dt>{k}</dt>
                      <dd className="tabular-nums">{v < 0 ? `−${money(-v)}` : money(v)}</dd>
                    </div>
                  ))}
                <div className="mt-1 flex justify-between border-t border-border pt-2 text-[15px] font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{money(r.totals.total)}</dd>
                </div>
              </dl>
            </Card>
          </div>
          {r.days.length > 1 && (
            <Card title="By day" action={<Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => csv(`days-${r.from}-${r.to}.csv`, ["Date", "Bills", "Covers", "Sales"], r.days.map((d) => [d.day, d.bills, d.covers, rupees(d.total)]))}>CSV</Button>}>
              <Bars label="Sales by day" data={r.days.map((d) => ({ key: d.day, value: d.total, title: `${new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })} · ${money(d.total)} · ${d.bills} bills` }))} />
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Payment methods">
              <Split rows={Object.entries(r.methods).map(([k, v]) => ({ label: METHOD_LABEL[k] ?? k, value: v }))} total={Object.values(r.methods).reduce((a, v) => a + v, 0)} />
            </Card>
            <Card title="Order types">
              <Split rows={Object.entries(r.types).map(([k, v]) => ({ label: `${SOURCE_LABEL[k] ?? k} · ${v.bills}`, value: v.total }))} total={r.totals.total} />
            </Card>
            <Card title="Staff">
              <Split rows={r.staff.map((s) => ({ label: `${s.name} · ${s.bills}`, value: s.total }))} total={r.totals.total} />
            </Card>
          </div>
          <Card title="GST summary" action={<Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => csv(`gst-${r.from}-${r.to}.csv`, ["Rate %", "Taxable value", "CGST", "SGST", "Total tax"], r.gst.map((g) => [g.rate / 100, rupees(g.taxable), rupees(g.cgst), rupees(g.sgst), rupees(g.tax)]))}>CSV</Button>}>
            <table className="w-full text-[13.5px]">
              <thead className="text-left text-[12px] text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Rate</th>
                  <th className="py-1.5 text-right font-medium">Taxable value</th>
                  <th className="py-1.5 text-right font-medium">CGST</th>
                  <th className="py-1.5 text-right font-medium">SGST</th>
                  <th className="py-1.5 text-right font-medium">Total tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.gst.map((g) => (
                  <tr key={g.rate}>
                    <td className="py-1.5">{g.rate / 100}%</td>
                    <td className="py-1.5 text-right tabular-nums">{money(g.taxable)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(g.cgst)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(g.sgst)}</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{money(g.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[12px] text-subtle">Within-state sales split equally into CGST and SGST. Rounding per bill can differ from these totals by a few paise.</p>
          </Card>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <Card title="Categories">
              <Split rows={r.categories.map((c) => ({ label: `${c.name} · ${c.qty}`, value: c.revenue }))} total={r.categories.reduce((a, c) => a + c.revenue, 0)} />
            </Card>
            <Card title="Dishes & drinks" action={<Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => csv(`items-${r.from}-${r.to}.csv`, ["Item", "Category", "Qty", "Revenue"], r.items.map((i) => [i.name, i.category, i.qty, rupees(i.revenue)]))}>CSV</Button>}>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-[13.5px]">
                  <tbody className="divide-y divide-border">
                    {r.items.map((i, n) => (
                      <tr key={i.name}>
                        <td className="py-1.5 pr-2 text-subtle tabular-nums">{n + 1}</td>
                        <td className="py-1.5">
                          {i.name} <span className="text-[12px] text-muted">· {i.category}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">× {i.qty}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums">{money(i.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <Card title="Loss prevention" action={<ShieldAlert className="size-4 text-muted" />}>
            <div className="mb-3 flex flex-wrap gap-2">
              {r.eventTotals.map((e) => (
                <span key={e.kind} className="rounded-full bg-surface-2 px-3 py-1 text-[12.5px]">
                  {EVENT_LABEL[e.kind]}: <b>{e.count}</b> · {money(e.amount)}
                </span>
              ))}
              <span className="rounded-full bg-surface-2 px-3 py-1 text-[12.5px]">
                Orders cancelled: <b>{r.cancelled.count}</b>
              </span>
            </div>
            {!r.events.length ? (
              <p className="text-[13px] text-muted">Nothing cancelled, discounted or comped in this range.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {r.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                    <Badge tone={e.kind === "void" || e.kind === "pay_out" ? "danger" : e.kind === "discount" || e.kind === "comp" ? "warning" : "neutral"}>{EVENT_LABEL[e.kind] ?? e.kind}</Badge>
                    <span className="min-w-0 flex-1 truncate">{e.detail}</span>
                    <span className="text-[12px] text-muted">
                      {e.staffName || "—"}
                      {e.approvedBy ? ` · approved by ${e.approvedBy}` : ""}
                    </span>
                    {e.amount > 0 && <b className="tabular-nums">{money(e.amount)}</b>}
                    <span className="w-28 text-right text-[12px] text-subtle">{new Date(e.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/** Rows with a share bar, largest first. */
function Split({ rows, total }: { rows: { label: string; value: number }[]; total: number }) {
  const money = useMoney();
  if (!rows.length) return <p className="text-[13px] text-muted">Nothing yet.</p>;
  return (
    <ul className="grid gap-2.5">
      {[...rows]
        .sort((a, b) => b.value - a.value)
        .map((r) => (
          <li key={r.label} className="text-[13px]">
            <div className="flex justify-between gap-2">
              <span className="truncate">{r.label}</span>
              <span className="tabular-nums">
                <b>{money(r.value)}</b> <span className="text-muted">{total ? Math.round((r.value / total) * 100) : 0}%</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-[var(--accent)] opacity-80" style={{ width: `${total ? (r.value / total) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
    </ul>
  );
}
