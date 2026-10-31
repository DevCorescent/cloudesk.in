"use client";

// Charts for reports: bars, lines, areas, a donut, a single number (with its
// change from the period before and an optional target) and the table. One
// axis only — the chart plots the measures that share the first measure's
// unit; the rest stay in the table. Series take the validated categorical
// slots in fixed order (--viz-1…6); a seventh and beyond fold into "Other".
// Every chart has a hover tooltip, a legend when there's more than one series,
// and the table one click away.
import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/primitives";
import { bucketLabel } from "@/lib/bi/model";

export type Column = { key: string; label: string; type: "date" | "text" | "number" | "money" | "bool" | "count"; bucket?: string | null };
export type Result = { dims: number; columns: Column[]; rows: (string | number | boolean | null)[][]; totals: (number | null)[]; range: { from: string | null; to: string | null }; truncated: boolean; compare?: { previous: number | null; change: number | null } | null };
export type ChartKind = "table" | "bar" | "line" | "area" | "pie" | "number";

const SLOTS = 6;
const color = (i: number) => (i < SLOTS ? `var(--viz-${i + 1})` : "var(--viz-other)");

export function fmtValue(v: unknown, c: Pick<Column, "type" | "bucket">, short = false): string {
  if (v === null || v === undefined || v === "") return "—";
  if (c.type === "money") {
    const r = Number(v) / 100;
    if (short && Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
    if (short && Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
    if (short && Math.abs(r) >= 1e3) return `₹${(r / 1e3).toFixed(r >= 1e4 ? 0 : 1)}k`;
    return `₹${r.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  if (c.type === "date") return bucketLabel(String(v), (c.bucket as never) ?? null);
  if (c.type === "bool") return v ? "Yes" : "No";
  if (typeof v === "number") return short && Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return String(v);
}

type Series = { name: string; values: (number | null)[] };
type Shape = { xLabels: string[]; series: Series[]; unit: Column; dropped: string[] };

/** From rows to an x axis and series: the first dimension is x; a second splits series; else the measures sharing the first's unit. */
export function shape(r: Result): Shape | null {
  const nd = r.dims;
  const measures = r.columns.slice(nd);
  if (!measures.length) return null;
  const unit = measures[0];
  const unitOf = (c: Column) => (c.type === "count" || c.type === "number" ? "n" : c.type);
  if (nd === 0) return { xLabels: [""], series: measures.filter((m) => unitOf(m) === unitOf(unit)).map((m) => ({ name: m.label, values: [Number(r.rows[0]?.[nd + measures.indexOf(m)] ?? 0)] })), unit, dropped: measures.filter((m) => unitOf(m) !== unitOf(unit)).map((m) => m.label) };
  const xs: string[] = [];
  const xKey = (row: Result["rows"][number]) => String(row[0] ?? "");
  for (const row of r.rows) if (!xs.includes(xKey(row))) xs.push(xKey(row));
  const xLabels = xs.map((x) => fmtValue(x === "" ? null : x, r.columns[0]));
  if (nd >= 2) {
    // Split by the second dimension; the biggest series take the colours, the rest fold into Other.
    const names: string[] = [];
    for (const row of r.rows) if (!names.includes(String(row[1] ?? "—"))) names.push(String(row[1] ?? "—"));
    const totalOf = (n: string) => r.rows.filter((row) => String(row[1] ?? "—") === n).reduce((a, row) => a + (Number(row[nd]) || 0), 0);
    const ranked = [...names].sort((a, b) => totalOf(b) - totalOf(a));
    const keep = ranked.length > SLOTS ? ranked.slice(0, SLOTS - 1) : ranked;
    // Colour follows the entity: keep the order they first appear in, not their rank.
    const kept = names.filter((n) => keep.includes(n));
    const series: Series[] = kept.map((n) => ({ name: fmtValue(n === "—" ? null : n, r.columns[1]), values: xs.map((x) => { const row = r.rows.find((y) => xKey(y) === x && String(y[1] ?? "—") === n); return row ? Number(row[nd]) : null; }) }));
    if (ranked.length > keep.length) series.push({ name: "Other", values: xs.map((x) => r.rows.filter((y) => xKey(y) === x && !keep.includes(String(y[1] ?? "—"))).reduce((a, y) => a + (Number(y[nd]) || 0), 0)) });
    return { xLabels, series, unit, dropped: measures.slice(1).map((m) => m.label) };
  }
  const same = measures.filter((m) => unitOf(m) === unitOf(unit));
  return { xLabels, series: same.map((m) => { const i = nd + measures.indexOf(m); return { name: m.label, values: xs.map((x) => { const row = r.rows.find((y) => xKey(y) === x); return row ? Number(row[i]) : null; }) }; }), unit, dropped: measures.filter((m) => unitOf(m) !== unitOf(unit)).map((m) => m.label) };
}

/** Measures come after the dimensions. */
const isMeasure = (r: Result, i: number) => i >= r.dims;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function niceMax(v: number, whole = false) {
  // Counts tick in whole numbers: four even steps.
  if (whole && v <= 20) return Math.max(4, Math.ceil(v / 4) * 4);
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.name} className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[3px]" style={{ background: color(s.name === "Other" ? SLOTS : i) }} />{s.name}</li>
      ))}
    </ul>
  );
}

type Tip = { x: number; y: number; title: string; lines: { name: string; value: string; i: number }[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-[10px] border border-border bg-surface-solid px-2.5 py-1.5 text-[12px] shadow-lg" style={{ left: tip.x, top: tip.y - 8 }}>
      <p className="mb-0.5 font-semibold">{tip.title}</p>
      {tip.lines.map((l) => <p key={l.name} className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5 text-muted"><span className="inline-block size-2 rounded-[2px]" style={{ background: color(l.name === "Other" ? SLOTS : l.i) }} />{l.name}</span><b className="tabular-nums">{l.value}</b></p>)}
    </div>
  );
}

const H = 240;
const PAD = { l: 52, r: 12, t: 12, b: 28 };

function Axis({ w, max, unit }: { w: number; max: number; unit: Column }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 4"} />
          <text x={PAD.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">{fmtValue(t, unit, true)}</text>
        </g>
      ))}
    </g>
  );
}

function XLabels({ labels, x, w }: { labels: string[]; x: (i: number) => number; w: number }) {
  const room = (w - PAD.l - PAD.r) / Math.max(1, labels.length);
  const step = Math.max(1, Math.ceil(70 / room));
  return <g aria-hidden>{labels.map((l, i) => (i % step === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{l.length > 14 ? `${l.slice(0, 13)}…` : l}</text> : null))}</g>;
}

function Bars({ s, w }: { s: Shape; w: number }) {
  const [tip, setTip] = useState<Tip>(null);
  const max = niceMax(Math.max(...s.series.flatMap((x) => x.values.map((v) => v ?? 0)), 0), s.unit.type === "count");
  const n = s.xLabels.length;
  const band = (w - PAD.l - PAD.r) / n;
  const inner = Math.min(band * 0.78, 28 * s.series.length + 2 * (s.series.length - 1));
  const bw = Math.max(2, (inner - 2 * (s.series.length - 1)) / s.series.length);
  const x0 = (i: number) => PAD.l + band * i + (band - inner) / 2;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const base = y(0);
  return (
    <div className="relative">
      <svg width={w} height={H} role="img" aria-label="Bar chart" onMouseLeave={() => setTip(null)}>
        <Axis w={w} max={max} unit={s.unit} />
        {s.xLabels.map((label, i) => (
          <g key={i}>
            {s.series.map((ser, j) => {
              const v = ser.values[i] ?? 0;
              const top = Math.min(y(Math.max(v, 0)), base - (v > 0 ? 1 : 0));
              const h = Math.max(v > 0 ? 1 : 0, base - top);
              const x = x0(i) + j * (bw + 2);
              const r = Math.min(4, bw / 2, h);
              // Rounded at the data end, square on the baseline.
              return <path key={j} d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`} fill={color(ser.name === "Other" ? SLOTS : j)} />;
            })}
            {/* The hit target is the whole band, bigger than the bars. */}
            <rect x={PAD.l + band * i} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="transparent" onMouseMove={() => setTip({ x: PAD.l + band * i + band / 2, y: y(Math.max(...s.series.map((ser) => ser.values[i] ?? 0), 0)), title: label, lines: s.series.map((ser, j) => ({ name: ser.name, value: fmtValue(ser.values[i], s.unit), i: j })) })} />
          </g>
        ))}
        <XLabels labels={s.xLabels} x={(i) => PAD.l + band * i + band / 2} w={w} />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function Lines({ s, w, area }: { s: Shape; w: number; area: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...s.series.flatMap((x) => x.values.map((v) => v ?? 0)), 0), s.unit.type === "count");
  const n = s.xLabels.length;
  const x = (i: number) => (n === 1 ? (PAD.l + w - PAD.r) / 2 : PAD.l + ((w - PAD.l - PAD.r) * i) / (n - 1));
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const tip: Tip = hover === null ? null : { x: x(hover), y: y(Math.max(...s.series.map((ser) => ser.values[hover] ?? 0), 0)), title: s.xLabels[hover], lines: s.series.map((ser, j) => ({ name: ser.name, value: fmtValue(ser.values[hover], s.unit), i: j })) };
  return (
    <div className="relative">
      <svg width={w} height={H} role="img" aria-label={area ? "Area chart" : "Line chart"} onMouseLeave={() => setHover(null)} onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = e.clientX - r.left; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / Math.max(1, w - PAD.l - PAD.r)) * (n - 1))))); }}>
        <Axis w={w} max={max} unit={s.unit} />
        {s.series.map((ser, j) => {
          const pts = ser.values.map((v, i) => `${x(i)},${y(v ?? 0)}`).join(" ");
          const c = color(ser.name === "Other" ? SLOTS : j);
          return (
            <g key={j}>
              {area && <polygon points={`${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`} fill={c} fillOpacity={s.series.length > 1 ? 0.12 : 0.18} />}
              <polyline points={pts} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hover !== null && (
          <g aria-hidden>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
            {s.series.map((ser, j) => <circle key={j} cx={x(hover)} cy={y(ser.values[hover] ?? 0)} r={4.5} fill={color(ser.name === "Other" ? SLOTS : j)} stroke="var(--surface-solid)" strokeWidth={2} />)}
          </g>
        )}
        <XLabels labels={s.xLabels} x={x} w={w} />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function Donut({ r, w }: { r: Result; w: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const nd = r.dims;
  const rows = r.rows.map((row) => ({ name: fmtValue(row[0], r.columns[0]), v: Math.max(0, Number(row[nd]) || 0) })).sort((a, b) => b.v - a.v);
  const slices = rows.length > SLOTS ? [...rows.slice(0, SLOTS - 1), { name: "Other", v: rows.slice(SLOTS - 1).reduce((a, x) => a + x.v, 0) }] : rows;
  const total = slices.reduce((a, x) => a + x.v, 0) || 1;
  const size = Math.min(220, w * 0.5);
  const R = size / 2;
  const r0 = R * 0.62;
  // Each slice starts where the ones before it end.
  const starts = slices.map((_, i) => -Math.PI / 2 + (slices.slice(0, i).reduce((n, x) => n + x.v, 0) / total) * Math.PI * 2);
  const arcs = slices.map((sl, i) => {
    const da = (sl.v / total) * Math.PI * 2;
    const a1 = starts[i];
    const a2 = a1 + da;
    const gap = slices.length > 1 ? 0.012 : 0;
    const p = (ang: number, rad: number) => `${R + rad * Math.cos(ang)},${R + rad * Math.sin(ang)}`;
    const large = da - 2 * gap > Math.PI ? 1 : 0;
    const d = da >= Math.PI * 2 - 1e-6 ? `M${R},${R - R} A${R},${R} 0 1 1 ${R - 0.01},${R - R} L${R - 0.01},${R - r0} A${r0},${r0} 0 1 0 ${R},${R - r0} Z` : `M${p(a1 + gap, R)} A${R},${R} 0 ${large} 1 ${p(a2 - gap, R)} L${p(a2 - gap, r0)} A${r0},${r0} 0 ${large} 0 ${p(a1 + gap, r0)} Z`;
    return { ...sl, d, i };
  });
  const unit = r.columns[nd];
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} role="img" aria-label="Donut chart" onMouseLeave={() => setHover(null)}>
        {arcs.map((x) => <path key={x.name} d={x.d} fill={color(x.name === "Other" ? SLOTS : x.i)} opacity={hover === null || hover === x.i ? 1 : 0.45} onMouseEnter={() => setHover(x.i)} />)}
        <text x={R} y={R - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">{hover === null ? "Total" : arcs[hover].name.slice(0, 16)}</text>
        <text x={R} y={R + 14} textAnchor="middle" fontSize={15} fontWeight={600} fill="var(--fg)">{fmtValue(hover === null ? total : arcs[hover].v, unit, true)}</text>
      </svg>
      <ul className="grid gap-1 text-[12.5px]" aria-label="Legend">
        {arcs.map((x) => <li key={x.name} className="flex items-center gap-2" onMouseEnter={() => setHover(x.i)} onMouseLeave={() => setHover(null)}><span className="inline-block size-2.5 rounded-[3px]" style={{ background: color(x.name === "Other" ? SLOTS : x.i) }} /><span className="min-w-0 flex-1 truncate">{x.name}</span><b className="tabular-nums">{fmtValue(x.v, unit)}</b><span className="w-10 text-right text-muted tabular-nums">{Math.round((x.v / total) * 100)}%</span></li>)}
      </ul>
    </div>
  );
}

export function NumberTile({ r, target }: { r: Result; target?: number | null }) {
  const nd = r.dims;
  const c = r.columns[nd];
  const v = Number(r.rows[0]?.[nd] ?? 0);
  const ch = r.compare?.change ?? null;
  const goal = target !== null && target !== undefined ? (c.type === "money" ? target * 100 : target) : null;
  return (
    <div>
      <p className="text-[34px] leading-tight font-semibold tracking-tight tabular-nums">{fmtValue(v, c)}</p>
      {r.compare && <p className="mt-1 text-[12.5px] text-muted">{ch === null ? "Nothing to compare with in the period before" : <><b className={cx("font-semibold", ch >= 0 ? "text-success" : "text-danger")}>{ch >= 0 ? "▲" : "▼"} {Math.abs(Math.round(ch * 1000) / 10)}%</b> on the period before ({fmtValue(r.compare.previous, c)})</>}</p>}
      {goal !== null && goal > 0 && (
        <div className="mt-3">
          <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (v / goal) * 100)}%`, background: "var(--viz-1)" }} /></span>
          <p className="mt-1 text-[12px] text-muted">{Math.round((v / goal) * 100)}% of the {fmtValue(goal, c)} target</p>
        </div>
      )}
    </div>
  );
}

export function ResultTable({ r, max = 1000 }: { r: Result; max?: number }) {
  const hasTotals = r.totals.some((t) => t !== null) && r.rows.length > 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] text-[13px]">
        <thead><tr className="text-left text-[12px] text-muted">{r.columns.map((c, i) => <th key={i} className={cx("py-1.5 pr-3 font-medium", isMeasure(r, i) && "text-right")}>{c.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{r.rows.slice(0, max).map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className={cx("py-1.5 pr-3", isMeasure(r, j) && "text-right tabular-nums")}>{fmtValue(v, r.columns[j])}</td>)}</tr>)}</tbody>
        {hasTotals && <tfoot><tr className="border-t border-border font-semibold">{r.totals.map((t, i) => <td key={i} className={cx("py-1.5 pr-3", isMeasure(r, i) && "text-right tabular-nums")}>{i === 0 ? "Total" : t === null ? "" : fmtValue(t, r.columns[i])}</td>)}</tr></tfoot>}
      </table>
      {r.truncated && <p className="mt-2 text-[12px] text-muted">Showing the first {r.rows.length} rows.</p>}
    </div>
  );
}

/** A result in the chart it asked for, with the table a click away. */
export function ChartView({ r, kind, target, compact }: { r: Result; kind: ChartKind; target?: number | null; compact?: boolean }) {
  const [table, setTable] = useState(kind === "table");
  const { ref, w } = useWidth();
  if (!r.rows.length) return <p className="py-8 text-center text-[13px] text-muted">No data for these dates and filters.</p>;
  if (kind === "number") return <NumberTile r={r} target={target} />;
  const s = shape(r);
  const chartable = !!s && s.xLabels.length > 0 && kind !== "table";
  return (
    <div ref={ref}>
      {chartable && !compact && (
        <div className="mb-2 flex justify-end">
          <button type="button" className="text-[12px] font-medium text-muted underline" onClick={() => setTable(!table)}>{table ? "Show the chart" : "Show the table"}</button>
        </div>
      )}
      {!chartable || table ? (
        <ResultTable r={r} max={compact ? 10 : 1000} />
      ) : kind === "pie" ? (
        <Donut r={r} w={w} />
      ) : (
        <>
          {kind === "bar" ? <Bars s={s!} w={w} /> : <Lines s={s!} w={w} area={kind === "area"} />}
          <Legend series={s!.series} />
          {s!.dropped.length > 0 && <p className="mt-1 text-[12px] text-muted">{s!.dropped.join(", ")} {s!.dropped.length === 1 ? "is" : "are"} in the table (a different unit, so not on this axis).</p>}
        </>
      )}
    </div>
  );
}
