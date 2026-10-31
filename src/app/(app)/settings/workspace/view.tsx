"use client";

// The workspace's lifecycle: letting platform support look in for a while,
// exporting everything, how long logs are kept, and deleting the workspace.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";

type Data = { owner: boolean; name: string; deletionScheduledAt: string | null; grants: { id: string; reason: string; expiresAt: string; by: string | null; active: boolean; createdAt: string }[]; exports: { id: string; status: string; size: number; tables: number; rows: number; error: string; createdAt: string; expiresAt: string | null }[]; retention: { auditMonths: number | null; notificationDays: number }; residency: { region: string | null; processors: { name: string; purpose: string }[] } };

export function WorkspaceView() {
  const { org } = useSession();
  const base = `/api/v1/orgs/${org.id}/lifecycle`;
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["lifecycle", org.id], queryFn: () => api<Data>(`${base}/`), refetchInterval: (d) => (d.state.data?.exports.some((e) => e.status === "queued") ? 3000 : false) });
  const [grant, setGrant] = useState({ hours: "24", reason: "" });
  const [ret, setRet] = useState<Data["retention"] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [cancel, setCancel] = useState(false);
  const run = async (path: string, method: string, body?: unknown, done?: string) => {
    try {
      await api(`${base}/${path}`, { method, body: body ?? {} });
      await qc.invalidateQueries({ queryKey: ["lifecycle", org.id] });
      if (done) toast({ tone: "success", title: done });
      return true;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return false;
    }
  };
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-60" />;
  const d = q.data;
  const r = ret ?? d.retention;
  return (
    <div className="space-y-4">
      {d.deletionScheduledAt && <Notice tone="danger" title={`This workspace will be deleted on ${dateTime(d.deletionScheduledAt)}`} action={d.owner ? <Button size="sm" onClick={() => setCancel(true)}>Cancel deletion</Button> : undefined}>Everything in it goes for good then. Export it first if you need it.</Notice>}
      <Card className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">Support access</h2>
        <p className="text-[13px] text-muted">Let Cloudesk support see this workspace&apos;s activity (not your records) for a while, to help with a problem. Each look is in your audit log. Support can&apos;t sign in as anyone.</p>
        {d.grants.filter((g) => g.active).map((g) => <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span>Open until {dateTime(g.expiresAt)} — “{g.reason}” ({g.by})</span><Button size="sm" variant="ghost" onClick={() => void run(`support/${g.id}`, "DELETE", undefined, "Support access ended")}>End now</Button></div>)}
        <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-end">
          <Field label="For">{(a) => <Select {...a} value={grant.hours} onChange={(e) => setGrant({ ...grant, hours: e.target.value })}><option value="4">4 hours</option><option value="24">24 hours</option><option value="72">3 days</option></Select>}</Field>
          <Field label="Why">{(a) => <Input {...a} value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} placeholder="Ticket #1234: invoices not sending" />}</Field>
          <Button disabled={!grant.reason.trim()} onClick={async () => { if (await run("support", "POST", { hours: Number(grant.hours), reason: grant.reason }, "Support can look in now")) setGrant({ ...grant, reason: "" }); }}>Allow</Button>
        </div>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">Where your data is kept</h2>
        <p className="text-[13px] text-muted">Every record and uploaded file is stored in this deployment&apos;s database{d.residency.region ? <>, in <b className="font-medium text-fg">{d.residency.region}</b></> : " — its operator hasn't declared which region that is (DATA_REGION)"}. One region holds every workspace here; choosing a region per workspace isn&apos;t available.</p>
        {d.residency.processors.length > 0 ? (
          <div className="text-[13px]">
            <p className="mb-1 text-muted">Outside services this deployment sends some data to, when you use the feature:</p>
            <ul className="list-disc space-y-0.5 pl-5">{d.residency.processors.map((p) => <li key={p.name}><b className="font-medium">{p.name}</b> — {p.purpose}</li>)}</ul>
          </div>
        ) : <p className="text-[13px] text-muted">No outside email or AI services are set up here.</p>}
        <p className="text-[12.5px] text-muted">Payment gateways, WhatsApp and other providers you connect in Settings send data to those providers as well.</p>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">Export everything</h2>
        <p className="text-[13px] text-muted">A gzipped JSON file of every record in this workspace (passwords, keys and secrets left out), ready in a few minutes and kept for 7 days.</p>
        {d.exports.map((e) => <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span>{dateTime(e.createdAt)} · {e.status === "done" ? `${e.tables} tables, ${e.rows.toLocaleString("en-IN")} records, ${(e.size / 1024 / 1024).toFixed(1)} MB` : e.status === "failed" ? `failed: ${e.error}` : "being made…"}</span>{e.status === "done" && e.expiresAt && new Date(e.expiresAt) > new Date() && <a className="font-medium underline" href={`${base}/exports/${e.id}/download`}>Download</a>}</div>)}
        <Button onClick={() => void run("exports", "POST", {}, "Export started — we'll email you when it's ready")}>Make an export</Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">How long logs are kept</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Audit log">{(a) => <Select {...a} value={r.auditMonths ?? ""} onChange={(e) => setRet({ ...r, auditMonths: e.target.value ? Number(e.target.value) : null })}><option value="">Forever</option><option value="12">1 year</option><option value="36">3 years</option><option value="84">7 years</option></Select>}</Field>
          <Field label="Notifications">{(a) => <Select {...a} value={r.notificationDays} onChange={(e) => setRet({ ...r, notificationDays: Number(e.target.value) })}><option value="90">90 days</option><option value="365">1 year</option><option value="1095">3 years</option></Select>}</Field>
        </div>
        <p className="text-[12.5px] text-muted">Indian rules often need books and their audit trail kept 8 years — check before shortening the audit log.</p>
        <Button disabled={!ret} onClick={async () => { if (await run("retention", "PUT", r, "Saved")) setRet(null); }}>Save</Button>
      </Card>
      {d.owner && !d.deletionScheduledAt && (
        <Card className="space-y-3 border-danger p-5">
          <h2 className="text-[15px] font-semibold text-danger">Delete this workspace</h2>
          <p className="text-[13px] text-muted">It&apos;s deleted 30 days after you ask, with everything in it. Any owner can cancel until then.</p>
          <Button variant="danger" onClick={() => setDeleting(true)}>Delete workspace…</Button>
        </Card>
      )}
      {deleting && (
        <Dialog open onClose={() => setDeleting(false)} title="Delete this workspace?" description={`Type ${d.name} to confirm. It will be deleted for good in 30 days.`} footer={<><Button onClick={() => setDeleting(false)}>Keep it</Button><Button variant="danger" disabled={confirm.trim() !== d.name} onClick={async () => { if (await run("deletion", "POST", { confirm }, "Deletion scheduled")) setDeleting(false); }}>Delete in 30 days</Button></>}>
          <Field label="Workspace name">{(a) => <Input {...a} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
          <div className="mt-2"><Badge tone="danger">This can&apos;t be undone after 30 days</Badge></div>
        </Dialog>
      )}
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} onConfirm={async () => { await run("deletion", "DELETE", undefined, "Deletion cancelled"); setCancel(false); }} title="Keep this workspace?" description="The scheduled deletion is cancelled." confirmLabel="Keep it" />
    </div>
  );
}
