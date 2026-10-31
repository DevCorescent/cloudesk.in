"use client";

// One client, end to end: who they are and who works there, their
// subscription (from Subscriptions), usage against its limits, web apps and domains, the revenue they take
// through the platform, and health and activity. Counts and totals only.
import clsx from "clsx";
import { useState } from "react";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import type { ClientDetailData } from "@/server/platform/clients";
import { bytes, num, Stat, useAdmin } from "./common";
import { MonthlyChart, money, SOURCE_LABEL } from "./revenue";
import { STATE, SubscriptionSummary, type Overview as SubOverview } from "./subscriptions";

type Tab = "overview" | "members" | "apps" | "revenue" | "usage" | "health";
const when = (v: unknown) => (v ? dateTime(String(v)) : "—");

export function ClientDetail({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const q = useAdmin<ClientDetailData>(`clients/${orgId}`);
  const [tab, setTab] = useState<Tab>("overview");
  const d = q.data;
  return (
    <Dialog open onClose={onClose} size="2xl" title={d?.profile.name ?? "Client"} description={d ? `${d.profile.slug} · client since ${when(d.profile.createdAt)}` : undefined} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !d ? <Skeleton className="h-72" /> : (
        <div className="min-w-0 space-y-4">
          <Flags d={d} orgId={orgId} />
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "members", label: `Members (${d.members.length})` },
              { value: "apps", label: `Web apps (${d.webApps.length})` },
              { value: "revenue", label: "Revenue" },
              { value: "usage", label: "Usage & limits" },
              { value: "health", label: "Health & activity" },
            ]}
          />
          {tab === "overview" && <Overview d={d} orgId={orgId} onClose={onClose} />}
          {tab === "members" && <Members d={d} />}
          {tab === "apps" && <Apps d={d} />}
          {tab === "revenue" && <Revenue d={d} />}
          {tab === "usage" && <Usage orgId={orgId} />}
          {tab === "health" && <Health d={d} />}
        </div>
      )}
    </Dialog>
  );
}

function Flags({ d, orgId }: { d: ClientDetailData; orgId: string }) {
  const h = d.health;
  const sub = useAdmin<SubOverview>(`subscriptions/${orgId}`).data;
  const flags = [
    h.suspended && <Badge key="s" tone="danger">Suspended{h.suspendedReason ? `: ${h.suspendedReason}` : ""}</Badge>,
    h.sitesOffline && <Badge key="o" tone="danger">Sites offline</Badge>,
    h.deletionScheduledAt && <Badge key="d" tone="warning">Deletion on {when(h.deletionScheduledAt)}</Badge>,
    h.pastDue && <Badge key="p" tone="danger">Payment past due</Badge>,
    h.failedDeploys7d > 0 && <Badge key="f" tone="warning">{h.failedDeploys7d} failed deploys this week</Badge>,
    h.deadJobs > 0 && <Badge key="j" tone="warning">{h.deadJobs} jobs gave up</Badge>,
  ].filter(Boolean);
  return <div className="flex flex-wrap gap-1.5">{flags.length ? flags : <Badge tone="success">Healthy</Badge>}{sub && <Badge tone={STATE[sub.state].tone}>{sub.subscription?.planName ?? "No subscription"} · {STATE[sub.state].label}</Badge>}{d.profile.industry && <Badge>{d.profile.industry}</Badge>}</div>;
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[11rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
      ))}
    </dl>
  );
}

function Overview({ d, orgId, onClose }: { d: ClientDetailData; orgId: string; onClose: () => void }) {
  const cur = d.revenue.byCurrency[0];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Members" value={num(d.members.length)} sub={`${d.members.filter((m) => m.mfa).length} with two-step`} />
        <Stat label="Web apps" value={num(d.webApps.filter((w) => !w.archivedAt).length)} sub={`${d.webApps.filter((w) => w.live).length} live`} />
        <Stat label={cur ? `Revenue 30 days · ${cur.currency}` : "Revenue 30 days"} value={cur ? money(cur.last30, cur.currency, true) : "—"} sub={cur ? `${money(cur.allTime, cur.currency, true)} all time` : "No payments recorded"} />
        <Stat label="Sign-ins (30 days)" value={num(d.signIns30.ok)} sub={`${d.signIns30.people} people · ${d.signIns30.failed} failed`} tone={d.signIns30.failed > d.signIns30.ok && d.signIns30.failed > 3 ? "warning" : undefined} />
      </div>
      <SubscriptionSummary orgId={orgId} onOpen={onClose} />
      <Card className="p-4">
        <KV
          rows={[
            ["Owners", d.owners.map((o) => `${o.name} <${o.email}>`).join(", ") || "—"],
            ["Billing email", d.billing.billingEmail || "—"],
            ["Two-step required", d.profile.requireMfa ? "Yes" : "No"],
            ["Modules on", d.modules.all ? `All (${d.modules.on.length})` : `${d.modules.on.length} — ${d.modules.on.map((m) => m.name).join(", ")}`],
            ["AI spend", `$${(d.ai.costMonthMicroUsd / 1e6).toFixed(2)} this month · $${(d.ai.cost30MicroUsd / 1e6).toFixed(2)} in 30 days · ${num(d.ai.tasks30)} tasks`],
            ["Storage", `${bytes(d.storage.bytes)} in ${num(d.storage.files)} files`],
            ["Operator note", d.profile.note || "—"],
          ]}
        />
      </Card>
    </div>
  );
}

function Members({ d }: { d: ClientDetailData }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">Person</th><th className="px-4 py-2.5 font-medium">Role</th><th className="px-4 py-2.5 font-medium">Security</th><th className="px-4 py-2.5 font-medium">Last seen</th></tr></thead>
        <tbody className="divide-y divide-border">
          {d.members.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-2.5"><b className="font-medium">{m.name}</b><span className="block text-[12px] text-muted">{m.email}</span></td>
              <td className="px-4 py-2.5 capitalize">{m.role}</td>
              <td className="px-4 py-2.5"><span className="flex flex-wrap gap-1">{m.mfa ? <Badge tone="success">two-step</Badge> : <Badge>no two-step</Badge>}{m.disabled && <Badge tone="danger">disabled</Badge>}</span></td>
              <td className="px-4 py-2.5 text-muted">{when(m.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Apps({ d }: { d: ClientDetailData }) {
  if (!d.webApps.length) return <Card className="p-6 text-center text-[13px] text-muted">No web apps yet.</Card>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-[13px]">
        <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">Web app</th><th className="px-4 py-2.5 font-medium">State</th><th className="px-4 py-2.5 font-medium">Domains</th><th className="px-4 py-2.5 font-medium">Last deploy</th></tr></thead>
        <tbody className="divide-y divide-border">
          {d.webApps.map((w) => (
            <tr key={w.id} className={clsx(w.archivedAt && "opacity-60")}>
              <td className="px-4 py-2.5"><b className="font-medium">{w.name}</b><span className="block text-[12px] text-muted">{w.slug} · {w.kind} · since {when(w.createdAt)}</span></td>
              <td className="px-4 py-2.5">{w.archivedAt ? <Badge>Archived</Badge> : w.live ? <Badge tone="success">Live</Badge> : <Badge>Not published</Badge>}</td>
              <td className="px-4 py-2.5">{w.domains.length ? <span className="flex flex-wrap gap-1">{w.domains.map((x) => <Badge key={x.hostname} tone={x.status === "verified" ? "success" : x.status === "failed" ? "danger" : "warning"}>{x.hostname}</Badge>)}</span> : <span className="text-muted">—</span>}</td>
              <td className="px-4 py-2.5">{w.lastDeployAt ? <span>{when(w.lastDeployAt)} <Badge tone={w.lastDeployStatus === "ready" ? "success" : w.lastDeployStatus === "failed" ? "danger" : "neutral"}>{w.lastDeployStatus}</Badge></span> : <span className="text-muted">Never</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Revenue({ d }: { d: ClientDetailData }) {
  if (!d.revenue.byCurrency.length) return <Card className="p-6 text-center text-[13px] text-muted">No paid orders, invoice payments or bills recorded in this workspace.</Card>;
  return (
    <div className="space-y-4">
      {d.revenue.byCurrency.map((c) => (
        <div key={c.currency} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label={`Last 30 days · ${c.currency}`} value={money(c.last30, c.currency, true)} sub={c.growthPct === null ? "no earlier period" : `${c.growthPct > 0 ? "+" : ""}${c.growthPct}% vs previous 30 days`} />
            <Stat label={`Previous 30 days · ${c.currency}`} value={money(c.prev30, c.currency, true)} />
            <Stat label={`All time · ${c.currency}`} value={money(c.allTime, c.currency, true)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="min-w-0 p-4">
              <p className="mb-2 text-[13px] font-semibold">Monthly · {c.currency}</p>
              <MonthlyChart currency={c.currency} points={d.revenue.monthly.filter((m) => m.currency === c.currency)} />
            </Card>
            <Card className="min-w-0 p-4 text-[13px]">
              <p className="mb-2 font-semibold">By source</p>
              <ul className="space-y-1.5">{c.bySource.map((s) => <li key={s.source} className="flex justify-between gap-2"><span className="truncate">{SOURCE_LABEL[s.source] ?? s.source}</span><span className="tabular-nums">{money(s.allTime, c.currency, true)} <span className="text-muted">· 30d {money(s.last30, c.currency, true)}</span></span></li>)}</ul>
            </Card>
          </div>
        </div>
      ))}
    </div>
  );
}

function Usage({ orgId }: { orgId: string }) {
  const q = useAdmin<SubOverview>(`subscriptions/${orgId}`);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d) return <Skeleton className="h-40" />;
  const rows: [string, "projects" | "seats" | "customDomains"][] = [["Web apps", "projects"], ["Seats (members + invites)", "seats"], ["Custom domains", "customDomains"]];
  return (
    <div className="space-y-3">
      <p className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px] text-muted">{!d.enforced ? "Subscriptions aren't enforced (Plans & pricing), so nothing is limited." : `${STATE[d.state].label}: ${STATE[d.state].line}`}</p>
      <Card className="divide-y divide-border">
        {rows.map(([label, k]) => {
          const used = d.usage[k];
          const limit = d.limits[k];
          const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          return (
            <div key={k} className="px-4 py-3 text-[13px]">
              <div className="flex justify-between gap-2"><span>{label}</span><b className="tabular-nums">{num(used)}{limit !== null ? ` / ${num(limit)}` : " · unlimited"}</b></div>
              {limit ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={clsx("h-full rounded-full", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-[var(--viz-1)]")} style={{ width: `${pct}%` }} /></div> : null}
            </div>
          );
        })}
        <div className="px-4 py-3 text-[13px]"><div className="flex justify-between gap-2"><span>Automations per web app (limit)</span><b className="tabular-nums">{d.limits.automationsPerProject ?? "unlimited"}</b></div></div>
        <div className="px-4 py-3 text-[13px]"><div className="flex justify-between gap-2"><span>Features</span><b className="tabular-nums">{d.entitled === null ? "every feature" : `${d.entitled.length} of ${d.stats.featuresTotal}`}</b></div></div>
      </Card>
    </div>
  );
}

function Health({ d }: { d: ClientDetailData }) {
  const max = Math.max(1, ...d.activity30.map((a) => a.n));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 text-[13px]">
        <p className="mb-2 font-semibold">Activity by area (30 days)</p>
        {d.activity30.length ? (
          <ul className="space-y-1.5">
            {d.activity30.slice(0, 14).map((a) => (
              <li key={a.area} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2">
                <span className="truncate text-muted">{a.area}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${(a.n / max) * 100}%` }} /></span>
                <span className="tabular-nums">{num(a.n)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted">No activity in 30 days.</p>}
      </Card>
      <div className="space-y-4">
        <Card className="p-4 text-[13px]">
          <p className="mb-2 font-semibold">Deployments</p>
          <p>{num(d.health.deploys30d)} in 30 days · <span className={d.health.failedDeploys7d ? "text-danger" : "text-muted"}>{d.health.failedDeploys7d} failed this week</span></p>
        </Card>
        <Card className="p-4 text-[13px]">
          <p className="mb-2 font-semibold">Background jobs failing</p>
          {d.jobs.length ? (
            <ul className="space-y-1.5">{d.jobs.map((j) => <li key={`${j.kind}-${j.status}`}><b className="font-medium">{j.kind}</b> <Badge tone={j.status === "dead" ? "danger" : "warning"}>{j.status === "dead" ? "gave up" : "retrying"} × {j.n}</Badge>{j.lastError && <span className="block truncate text-[12px] text-danger" title={j.lastError}>{j.lastError}</span>}</li>)}</ul>
          ) : <p className="text-muted">Nothing failing.</p>}
        </Card>
      </div>
    </div>
  );
}
