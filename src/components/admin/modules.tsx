"use client";

// How every module is used across the platform: switched on vs actually used,
// records in the last 30 days against the 30 before, and each module's own
// figures. A module opens to its daily trend and busiest workspaces.
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Input, Select, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { MODULE_GROUPS } from "@/lib/workspace/modules";
import { DailyChart, num, Section, Stat, useAdmin } from "./common";

type Kpi = { label: string; value: number; format: "count" | "money" | "usd_micro" | "percent" | "duration_min"; currency?: string };
type Usage = { id: string; name: string; group: string; unit: string | null; enabledWorkspaces: number; activeWorkspaces30: number; records: number; records30: number; recordsPrev30: number; growthPct: number | null; measured: boolean; kpis: Kpi[]; error?: string };
type Detail = Usage & { trend: { day: string; n: number }[]; top: { orgId: string; name: string; slug: string; records30: number }[] };

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED ", SGD: "S$" };

export function fmtKpi(k: Kpi) {
  if (k.format === "money") {
    const v = (k.value / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    return k.currency ? `${SYMBOL[k.currency] ?? `${k.currency} `}${v}` : v;
  }
  if (k.format === "usd_micro") return `$${(k.value / 1e6).toFixed(2)}`;
  if (k.format === "percent") return `${k.value}%`;
  if (k.format === "duration_min") return k.value >= 120 ? `${(k.value / 60).toLocaleString("en-IN", { maximumFractionDigits: 1 })} h` : `${k.value} min`;
  return Number.isInteger(k.value) ? num(k.value) : k.value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function Growth({ pct, prev }: { pct: number | null; prev: number }) {
  if (pct === null) return <Badge>{prev === 0 ? "new" : "—"}</Badge>;
  const up = pct >= 0;
  return (
    <Badge tone={pct === 0 ? "neutral" : up ? "success" : "danger"}>
      <span className="inline-flex items-center gap-0.5">{up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(pct)}%</span>
    </Badge>
  );
}

const GROUP_LABEL: Record<string, string> = Object.fromEntries(MODULE_GROUPS.map((g) => [g.id, g.label]));

export function ModulesPanel() {
  const q = useAdmin<{ modules: Usage[]; generatedAt: string }>("modules", { refetchInterval: 120_000 });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"activity" | "adoption" | "growth" | "name">("activity");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    const xs = (q.data?.modules ?? []).filter((m) => !s || m.name.toLowerCase().includes(s) || m.id.includes(s));
    const by = {
      activity: (a: Usage, b: Usage) => b.records30 - a.records30 || b.activeWorkspaces30 - a.activeWorkspaces30,
      adoption: (a: Usage, b: Usage) => b.activeWorkspaces30 - a.activeWorkspaces30 || b.enabledWorkspaces - a.enabledWorkspaces,
      growth: (a: Usage, b: Usage) => (b.growthPct ?? -Infinity) - (a.growthPct ?? -Infinity),
      name: (a: Usage, b: Usage) => a.name.localeCompare(b.name),
    }[sort];
    return [...xs].sort(by);
  }, [q.data, search, sort]);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const all = q.data.modules;
  const used = all.filter((m) => m.activeWorkspaces30 > 0).length;
  const records30 = all.reduce((a, m) => a + m.records30, 0);
  const busiest = [...all].sort((a, b) => b.activeWorkspaces30 - a.activeWorkspaces30)[0];
  const groups = sort === "name" || sort === "activity" ? [...new Set(list.map((m) => m.group))] : [null];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Modules in use" value={`${used} / ${all.length}`} sub="with activity in the last 30 days" />
        <Stat label="Records created (30 d)" value={num(records30)} sub="across every module" />
        <Stat label="Most adopted" value={busiest ? busiest.name : "—"} sub={busiest ? `${num(busiest.activeWorkspaces30)} active workspaces` : undefined} />
        <Stat label="Not measured" value={num(all.filter((m) => !m.measured).length)} sub="switched-on counts only" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Search modules" className="!w-60 pl-8" placeholder="Search modules" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Sort modules" className="!w-48" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="activity">Most activity</option>
          <option value="adoption">Most workspaces using it</option>
          <option value="growth">Fastest growing</option>
          <option value="name">Name</option>
        </Select>
        <p className="ml-auto text-[12px] text-subtle">Measured {new Date(q.data.generatedAt).toLocaleTimeString()}</p>
      </div>

      {groups.map((g) => {
        const rows = g === null ? list : list.filter((m) => m.group === g);
        if (!rows.length) return null;
        const cards = (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((m) => (
              <button key={m.id} type="button" onClick={() => setOpen(m.id)} data-testid={`module-${m.id}`} className="min-w-0 text-left">
                <Card className={clsx("h-full p-4 transition-shadow hover:shadow-md", !m.measured && "border-dashed")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold">{m.name}</p>
                      <p className="truncate text-[12px] text-muted">{m.unit ?? "No activity data recorded for this module"}</p>
                    </div>
                    {m.error ? <Badge tone="danger">error</Badge> : m.measured && <Growth pct={m.growthPct} prev={m.recordsPrev30} />}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
                    <div><p className="text-subtle">Using it (30 d)</p><p className="font-semibold tabular-nums">{num(m.activeWorkspaces30)} <span className="font-normal text-muted">/ {num(m.enabledWorkspaces)} on</span></p></div>
                    <div><p className="text-subtle">Records (30 d)</p><p className="font-semibold tabular-nums">{m.measured ? num(m.records30) : "—"}</p></div>
                  </div>
                  {m.kpis.length > 0 && (
                    <ul className="mt-3 space-y-0.5 border-t border-border pt-2 text-[12.5px]">
                      {m.kpis.slice(0, 2).map((k, i) => (
                        <li key={i} className="flex justify-between gap-2"><span className="truncate text-muted">{k.label}</span><b className="shrink-0 font-medium tabular-nums">{fmtKpi(k)}</b></li>
                      ))}
                    </ul>
                  )}
                </Card>
              </button>
            ))}
          </div>
        );
        return g === null ? <div key="all">{cards}</div> : <Section key={g} title={GROUP_LABEL[g] ?? (g === "platform" ? "Grow & build" : g)}>{cards}</Section>;
      })}
      {!list.length && <p className="py-8 text-center text-[13px] text-muted">No module matches “{search}”.</p>}
      {open && <ModuleDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ModuleDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdmin<Detail>(`modules/${id}`);
  const d = q.data;
  return (
    <Dialog open onClose={onClose} size="lg" title={d?.name ?? "Module"} description={d?.unit ? `Measured from ${d.unit}` : undefined} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : !d ? <Skeleton className="h-60" /> : (
        <div className="space-y-5">
          {d.error && <p className="rounded-[12px] bg-danger-soft p-3 text-[13px] text-danger">Couldn&apos;t measure this module: {d.error}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Switched on", num(d.enabledWorkspaces)], ["Using it (30 d)", num(d.activeWorkspaces30)], ["Records (30 d)", d.measured ? num(d.records30) : "—"], ["All records", d.measured ? num(d.records) : "—"]].map(([l, v]) => (
              <div key={l} className="rounded-[12px] bg-surface-2 px-3 py-2"><p className="text-[11.5px] text-muted">{l}</p><p className="font-semibold tabular-nums">{v}</p></div>
            ))}
          </div>
          {!d.measured ? (
            <p className="text-[13px] text-muted">No activity data recorded for this module — only how many workspaces have it switched on.</p>
          ) : (
            <>
              <div>
                <p className="mb-1 flex flex-wrap items-center gap-2 text-[13px] font-medium">Daily activity, last 30 days <Growth pct={d.growthPct} prev={d.recordsPrev30} /><span className="font-normal text-muted">vs {num(d.recordsPrev30)} in the 30 days before</span></p>
                <DailyChart series={[{ label: d.unit ?? "Records", points: d.trend }]} />
              </div>
              {d.kpis.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {d.kpis.map((k, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-[12px] border border-border px-3 py-2 text-[13px]"><span className="text-muted">{k.label}{k.currency ? ` (${k.currency})` : ""}</span><b className="font-semibold tabular-nums">{fmtKpi(k)}</b></div>
                  ))}
                </div>
              )}
              <div>
                <p className="mb-1 text-[13px] font-medium">Busiest workspaces (30 d)</p>
                {d.top.length ? (
                  <ol className="divide-y divide-border rounded-[12px] border border-border text-[13px]">
                    {d.top.map((t, i) => <li key={t.orgId} className="flex items-center justify-between gap-2 px-3 py-2"><span className="min-w-0 truncate"><span className="text-subtle">{i + 1}.</span> {t.name} <span className="text-[12px] text-muted">{t.slug}</span></span><span className="tabular-nums">{num(t.records30)}</span></li>)}
                  </ol>
                ) : <p className="text-[13px] text-muted">No workspace used it in the last 30 days.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
