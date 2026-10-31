"use client";

// Live system health: database, this server, jobs and schedulers, and what
// has been failing across all workspaces in the last day. Refreshes itself.
import clsx from "clsx";
import { Badge, Button, Card, ErrorState, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { bytes, duration, num, Section, Stat, useAdmin, useCan, useRun } from "./common";

export type Health = {
  database: { ok: boolean; latencyMs: number; version: string; sizeBytes: number; connections: number; maxConnections: number; migrations: { applied: number; files: number | null }; tables: { name: string; bytes: number; rows: number }[] };
  server: { role: string; node: string; env: string; version: string; region: string; uptimeSec: number; rssBytes: number; heapUsedBytes: number; heapTotalBytes: number; pid: number };
  jobs: { byStatus: Record<string, number>; overdue: number; oldestOverdue: string | null; failing: { kind: string; n: number; dead: number; last_error: string | null; last: string }[] };
  schedulers: { key: string; on: boolean }[];
  problems: { deployments: { project: string; org: string; at: string }[]; domains: { domain: string; org: string; status: string }[]; externalPublishing: { name: string; provider: string; error: string; org: string }[]; emails: Record<string, number>; webhooks: number; loginFailures: { ip: string; n: number }[] };
};

export function useHealth() {
  return useAdmin<Health>("health", { refetchInterval: 20_000 });
}

export function HealthPanel() {
  const q = useHealth();
  const run = useRun();
  const can = useCan();
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { database: d, server: s, jobs: j, problems: p } = q.data;
  const migOk = d.migrations.files === null || d.migrations.applied >= d.migrations.files;
  const connPct = d.maxConnections ? Math.round((d.connections / d.maxConnections) * 100) : 0;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Database" value={`${d.latencyMs} ms`} sub={`round trip · ${bytes(d.sizeBytes)}`} tone={d.latencyMs > 100 ? "warning" : "success"} />
        <Stat label="Connections" value={`${d.connections} / ${d.maxConnections}`} sub={`${connPct}% of the limit`} tone={connPct > 80 ? "danger" : connPct > 60 ? "warning" : undefined} />
        <Stat label="Migrations" value={`${d.migrations.applied}${d.migrations.files !== null ? ` / ${d.migrations.files}` : ""}`} sub={migOk ? "Up to date" : "Pending — run npm run db:migrate"} tone={migOk ? "success" : "danger"} />
        <Stat label="Jobs waiting too long" value={num(j.overdue)} sub={j.oldestOverdue ? `oldest since ${dateTime(j.oldestOverdue)}` : "None over 5 minutes"} tone={j.overdue ? "danger" : "success"} />
        <Stat label="This server" value={duration(s.uptimeSec)} sub={`up · Node ${s.node} · ${s.env}`} />
        <Stat label="Memory" value={bytes(s.rssBytes)} sub={`heap ${bytes(s.heapUsedBytes)} of ${bytes(s.heapTotalBytes)}`} />
        <Stat label="Emails (24 h)" value={num(Object.values(p.emails).reduce((a, b) => a + b, 0))} sub={`${p.emails.failed ?? 0} failed · ${p.emails.retrying ?? 0} retrying`} tone={p.emails.failed ? "warning" : undefined} />
        <Stat label="Webhooks failed (24 h)" value={num(p.webhooks)} tone={p.webhooks ? "warning" : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Background jobs" sub="All workspaces">
          <Card className="space-y-3 p-4 text-[13px]">
            <div className="flex flex-wrap gap-1.5">{Object.entries(j.byStatus).map(([k, n]) => <Badge key={k} tone={k === "dead" ? "danger" : k === "failed" ? "warning" : k === "running" ? "accent" : k === "succeeded" ? "success" : "neutral"}>{k} {num(n)}</Badge>)}{!Object.keys(j.byStatus).length && <span className="text-muted">No jobs yet.</span>}</div>
            {j.failing.length > 0 && (
              <ul className="space-y-2">
                {j.failing.map((f) => (
                  <li key={f.kind} className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <b className="font-medium">{f.kind}</b> <span className="text-muted">× {f.n} in 7 days{f.dead ? ` · ${f.dead} gave up` : " · retrying"}</span>
                      {f.last_error && <span className="block truncate text-[12px] text-danger" title={f.last_error}>{f.last_error}</span>}
                    </span>
                    {f.dead > 0 && can("tenants:write") && <Button size="sm" variant="ghost" onClick={() => void run("jobs/retry", "POST", { kind: f.kind }, `${f.dead} job(s) queued again`)}>Retry</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
        <Section title="Schedulers on this server" sub="Turned off with the variable set to off">
          <Card className="flex flex-wrap gap-1.5 p-4">{q.data.schedulers.map((x) => <Badge key={x.key} tone={x.on ? "success" : "neutral"}>{x.key} {x.on ? "on" : "off"}</Badge>)}</Card>
        </Section>
      </div>

      <Section title="Failing in the last day" sub="Across every workspace">
        <div className="grid gap-3 lg:grid-cols-2">
          <Problems title="Deployments" empty="No failed deployments." rows={p.deployments.map((x) => `${x.org} · ${x.project} · ${dateTime(x.at)}`)} />
          <Problems title="Custom domains" empty="No failing domains." rows={p.domains.map((x) => `${x.domain} · ${x.org}`)} />
          <Problems title="Publishing elsewhere" empty="Nothing failing." rows={p.externalPublishing.map((x) => `${x.org} · ${x.name} (${x.provider}): ${x.error}`)} />
          <Problems title="Failed sign-ins by address" empty="No failed sign-ins." rows={p.loginFailures.map((x) => `${x.ip} — ${x.n} failed`)} />
        </div>
      </Section>

      <Section title="Largest tables" sub={d.version}>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2 font-medium">Table</th><th className="px-4 py-2 text-right font-medium">Rows</th><th className="px-4 py-2 text-right font-medium">Size</th></tr></thead>
            <tbody className="divide-y divide-border">{d.tables.map((t) => <tr key={t.name}><td className="px-4 py-2 font-mono text-[12px]">{t.name}</td><td className="px-4 py-2 text-right tabular-nums">{num(t.rows)}</td><td className="px-4 py-2 text-right tabular-nums">{bytes(t.bytes)}</td></tr>)}</tbody>
          </table>
        </Card>
      </Section>
    </div>
  );
}

function Problems({ title, rows, empty }: { title: string; rows: string[]; empty: string }) {
  return (
    <Card className="p-4 text-[13px]">
      <p className="mb-1.5 flex items-center gap-2 font-medium">{title}<Badge tone={rows.length ? "danger" : "success"}>{rows.length}</Badge></p>
      {rows.length ? <ul className={clsx("space-y-1 text-[12.5px] text-muted")}>{rows.map((r, i) => <li key={i} className="truncate" title={r}>{r}</li>)}</ul> : <p className="text-muted">{empty}</p>}
    </Card>
  );
}
