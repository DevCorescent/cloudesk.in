"use client";

// A chart the copilot drew inside an answer (its show_chart tool), drawn by
// the same chart component as Reports so it reads the same everywhere. The
// figures are the ones it looked up; money comes in rupees.
import { ChartView, type Result } from "@/components/bi/chart";
import type { ChartSpec } from "@/lib/copilot/model";

function resultOf(c: ChartSpec): Result {
  const money = c.unit === "money";
  return {
    dims: 1,
    columns: [{ key: "k", label: "", type: "text" }, ...c.series.map((s, i) => ({ key: `s${i}`, label: c.unit === "percent" ? `${s.name} (%)` : s.name, type: money ? ("money" as const) : ("number" as const) }))],
    rows: c.labels.map((l, i) => [l, ...c.series.map((s) => (money ? Math.round((s.values[i] ?? 0) * 100) : (s.values[i] ?? 0)))]),
    totals: [null, ...c.series.map((s) => (c.unit === "percent" ? null : s.values.reduce((a, v) => a + v, 0) * (money ? 100 : 1)))],
    range: { from: null, to: null },
    truncated: false,
  };
}

export function AnswerChart({ chart, className }: { chart: ChartSpec; className?: string }) {
  return (
    <figure className={className ?? "ai-chart"}>
      {chart.title && <figcaption>{chart.title}</figcaption>}
      <ChartView r={resultOf(chart)} kind={chart.kind} compact />
    </figure>
  );
}
