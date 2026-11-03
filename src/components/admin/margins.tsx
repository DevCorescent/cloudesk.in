"use client";

// Margins: what each workspace pays each month against what it costs to run
// this month — AI (what the provider charged), campaign email and storage, at
// rough provider prices — worst first, so a plan or a customer that loses money
// shows up before the bill does. A row opens its subscription to act on it.
import { Download } from "lucide-react";
import { Badge, Card, ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { money } from "@/lib/billing/catalog";
import { num, Section, Stat, useAdmin } from "./common";
import { openSubscription } from "./subscriptions";

type Row = { orgId: string; name: string; slug: string; plan: string; status: string; complimentary: boolean; revenue: number; aiUsd: number; emails: number; storageMb: number; cost: number; margin: number; losing: boolean };
type Res = { currency: string; usdInr: number; since: string; totals: { revenue: number; cost: number; margin: number; losing: number }; workspaces: Row[] };

export function MarginsPanel() {
  const q = useAdmin<Res>("margins");
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const d = q.data;
  const cur = d.currency;
  const csv = () => {
    const head = ["Workspace", "Plan", "Status", "Revenue/month", "AI US$", "Campaign emails", "Storage MB", "Cost", "Margin"];
    const rows = d.workspaces.map((r) => [r.name, r.plan, r.status, r.revenue / 100, r.aiUsd, r.emails, r.storageMb, r.cost / 100, r.margin / 100]);
    const text = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = "margins.csv";
    a.click();
  };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Revenue this month" value={money(d.totals.revenue, cur)} sub="What paying workspaces pay per month" />
        <Stat label="Running cost this month" value={money(d.totals.cost, cur)} sub={`AI, campaign email and storage · ₹${d.usdInr}/US$`} />
        <Stat label="Margin" value={money(d.totals.margin, cur)} tone={d.totals.margin < 0 ? "danger" : "success"} sub={d.totals.revenue ? `${Math.round((d.totals.margin / d.totals.revenue) * 100)}% of revenue` : undefined} />
        <Stat label="Losing money" value={num(d.totals.losing)} tone={d.totals.losing ? "danger" : undefined} sub="Cost more than they pay this month" />
      </div>
      <Section title="Every workspace, worst first" sub="Trials, Free and complimentary workspaces earn nothing, so any cost there is a loss — cap them with plan allowances, or set an override on the workspace." actions={<button type="button" onClick={csv} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> Export CSV</button>}>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle">
              <tr><th className="px-4 py-2.5 font-medium">Workspace</th><th className="px-4 py-2.5 font-medium">Plan</th><th className="px-4 py-2.5 text-right font-medium">Pays / month</th><th className="px-4 py-2.5 text-right font-medium">AI</th><th className="px-4 py-2.5 text-right font-medium">Campaign emails</th><th className="px-4 py-2.5 text-right font-medium">Storage</th><th className="px-4 py-2.5 text-right font-medium">Cost</th><th className="px-4 py-2.5 text-right font-medium">Margin</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.workspaces.map((r) => (
                <tr key={r.orgId} className="cursor-pointer hover:bg-surface-2" onClick={() => openSubscription(r.orgId)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") openSubscription(r.orgId); }}>
                  <td className="px-4 py-2.5"><b className="font-medium">{r.name}</b><span className="block text-[12px] text-muted">{r.slug}</span></td>
                  <td className="px-4 py-2.5">{r.plan || "—"}<span className="block text-[12px] text-muted">{r.complimentary ? "Complimentary" : r.status}</span></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.revenue ? money(r.revenue, cur) : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">${r.aiUsd.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{num(r.emails)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.storageMb >= 1024 ? `${(r.storageMb / 1024).toFixed(1)} GB` : `${num(r.storageMb)} MB`}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(r.cost, cur)}</td>
                  <td className={cx("px-4 py-2.5 text-right font-medium tabular-nums", r.margin < 0 ? "text-danger" : "text-success")}>{money(r.margin, cur)}{r.losing && <Badge tone="danger" className="ml-2">Loss</Badge>}</td>
                </tr>
              ))}
              {!d.workspaces.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">No subscriptions yet.</td></tr>}
            </tbody>
          </table>
        </Card>
        <p className="text-[12px] text-muted">Since {new Date(d.since).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}. AI is what providers actually charged; email is counted at US$0.0004 a message and storage at US$0.023 per GB-month. Set the ₹/US$ rate and the AI target in Plans & pricing.</p>
      </Section>
    </div>
  );
}
