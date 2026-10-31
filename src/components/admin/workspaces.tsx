"use client";

// Every workspace: plan and state at a glance, then per workspace — usage,
// owners, its subscription (managed in Subscriptions), suspend or lift, a
// private note, and activity only while the owner has granted support access.
import { useState } from "react";
import { Download } from "lucide-react";
import { ConfirmDialog, Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { ClientDetail } from "./client";
import { num, useAdmin, useCan, useRun } from "./common";
import { Nested, StatusChip, SubscriptionSummary } from "./subscriptions";

type Tenant = { id: string; name: string; slug: string; plan: string; paidPlan: string; subscriptionStatus: string | null; trialPlan: string | null; trialEndsAt: string | null; compPlan: string | null; note: string; modules: string[] | null; suspendedAt: string | null; suspendedReason: string; sitesOffline: boolean; deletionScheduledAt: string | null; industry: string | null; members: number; lastActive: string | null; createdAt: string };
type Detail = { tenant: Tenant; owners: { name: string; email: string }[]; usage: { projects: number; live: number; members: number; orders30: number; ai_cost: number }; grant: { reason: string; expiresAt: string } | null; support: { activity: { action: string; targetType: string | null; createdAt: string }[]; modules: string[] | null } | null };

export function WorkspacesPanel() {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const qs = new URLSearchParams({ q, state }).toString();
  const list = useAdmin<{ tenants: Tenant[] }>(`tenants?${qs}`);
  // The subscription per workspace (plan and status), from the Subscriptions list.
  const subs = useAdmin<{ rows: { orgId: string; planName: string; status: Parameters<typeof StatusChip>[0]["s"]; trialEndsAt: string | null; complimentary: boolean }[] }>(`subscriptions?limit=500${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const subOf = new Map((subs.data?.rows ?? []).map((r) => [r.orgId, r]));
  const [open, setOpen] = useState<string | null>(null);
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search workspaces" className="!w-64" placeholder="Name or address" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Show" className="!w-44" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All</option><option value="suspended">Suspended</option><option value="deleting">Being deleted</option>
        </Select>
        <a href={`/api/v1/admin/tenants/csv?${qs}`} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> Export CSV</a>
      </div>
      {!list.data ? <Skeleton className="h-60" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">Workspace</th><th className="px-4 py-2.5 font-medium">Subscription</th><th className="px-4 py-2.5 text-right font-medium">Members</th><th className="px-4 py-2.5 font-medium">Last activity</th><th className="px-4 py-2.5 font-medium">State</th></tr></thead>
            <tbody className="divide-y divide-border">
              {list.data.tenants.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setOpen(t.id)}>
                  <td className="px-4 py-2.5"><b className="font-medium">{t.name}</b><span className="block text-[12px] text-muted">{t.slug} · since {dateTime(t.createdAt)}</span></td>
                  <td className="px-4 py-2.5">{subOf.get(t.id) ? <span className="flex flex-wrap items-center gap-1.5">{subOf.get(t.id)!.planName}<StatusChip s={subOf.get(t.id)!.status} trialEndsAt={subOf.get(t.id)!.trialEndsAt} />{subOf.get(t.id)!.complimentary && <Badge tone="accent">comp</Badge>}</span> : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.members}</td>
                  <td className="px-4 py-2.5 text-muted">{t.lastActive ? dateTime(t.lastActive) : "—"}</td>
                  <td className="px-4 py-2.5">{t.suspendedAt ? <Badge tone="danger">Suspended</Badge> : t.deletionScheduledAt ? <Badge tone="warning">Deleting</Badge> : <Badge tone="success">Active</Badge>}</td>
                </tr>
              ))}
              {!list.data.tenants.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No workspaces match.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {open && <TenantDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TenantDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdmin<Detail>(`tenants/${id}`);
  const run = useRun();
  const can = useCan();
  const write = can("tenants:write");
  const [reason, setReason] = useState("");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [offline, setOffline] = useState(false);
  const [profile, setProfile] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const t = q.data?.tenant;
  const u = q.data?.usage;
  return (
    <Dialog open onClose={onClose} size="lg" title={t?.name ?? "Workspace"} description={t ? `${t.slug} · created ${dateTime(t.createdAt)}` : undefined} footer={<><Button onClick={() => setProfile(true)}>Full profile</Button><Button variant="primary" onClick={onClose}>Close</Button></>}>
      {!q.data || !t || !u ? <Skeleton className="h-40" /> : (
        <div className="space-y-5 text-[13.5px]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[["Web apps", u.projects], ["Live", u.live], ["Members", u.members], ["Orders (30 d)", u.orders30], ["AI this month", `$${(Number(u.ai_cost) / 1e6).toFixed(2)}`]].map(([l, v]) => (
              <div key={String(l)} className="rounded-[12px] bg-surface-2 px-3 py-2"><p className="text-[11.5px] text-muted">{l}</p><p className="font-semibold tabular-nums">{typeof v === "number" ? num(v) : v}</p></div>
            ))}
          </div>
          <p>Owners: {q.data.owners.map((o) => `${o.name} <${o.email}>`).join(", ") || "—"}</p>
          {t.industry && <p className="text-muted">Industry: {t.industry}</p>}
          <SubscriptionSummary orgId={id} />
          {write && (
            <>
              {t.suspendedAt ? (
                <div className="flex items-center justify-between gap-2 rounded-[14px] bg-danger-soft p-3"><span>Suspended {dateTime(t.suspendedAt)}: {t.suspendedReason}{t.sitesOffline && <b className="font-medium"> · sites offline</b>}</span><Button size="sm" onClick={() => void run(`tenants/${id}/unsuspend`, "POST", {}, "Suspension lifted")}>Lift</Button></div>
              ) : (
                <div className="flex gap-2"><Input aria-label="Reason to suspend" placeholder="Reason to suspend" value={reason} onChange={(e) => setReason(e.target.value)} /><Button variant="danger" disabled={!reason.trim()} onClick={() => setConfirmSuspend(true)}>Suspend</Button></div>
              )}
              <Field label="Private note" hint="Only platform admins see this.">
                {(a) => <Textarea {...a} rows={2} value={note ?? t.note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== null && note !== t.note && void run(`tenants/${id}/note`, "PUT", { note }, "Note saved")} />}
              </Field>
            </>
          )}
          {q.data.support ? (
            <div className="space-y-1">
              <p className="font-medium">Support access until {dateTime(q.data.grant!.expiresAt)} — “{q.data.grant!.reason}”</p>
              <p className="text-muted">Modules: {q.data.support.modules?.join(", ") ?? "all"}</p>
              <ul className="max-h-60 overflow-y-auto text-[12.5px]">{q.data.support.activity.map((a, i) => <li key={i}>{dateTime(a.createdAt)} · {a.action}</li>)}</ul>
            </div>
          ) : <p className="text-muted">Activity is visible only while an owner grants support access (Settings → Workspace). Usage above is counts only.</p>}
        </div>
      )}
      {profile && <Nested><ClientDetail orgId={id} onClose={() => setProfile(false)} /></Nested>}
      <Nested>
      <ConfirmDialog
        open={confirmSuspend}
        onClose={() => setConfirmSuspend(false)}
        destructive
        title={`Suspend ${t?.name}?`}
        description={
          <div className="space-y-3">
            <p>Members can&apos;t open the workspace until it&apos;s lifted.</p>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
              <span>Also take its public sites and stores offline<span className="block text-muted">For abuse such as phishing or fraud. Visitors see “unavailable”.</span></span>
            </label>
          </div>
        }
        confirmLabel="Suspend"
        onConfirm={async () => {
          if (await run(`tenants/${id}/suspend`, "POST", { reason, sitesOffline: offline }, offline ? "Suspended, sites offline" : "Suspended")) setReason("");
          setConfirmSuspend(false);
        }}
      />
      </Nested>
    </Dialog>
  );
}
