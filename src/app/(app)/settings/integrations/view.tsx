"use client";

// The workspace integration hub: webhooks for ERP events, keys for the ERP
// API, background work that failed (and retrying it), and reconciliation of
// events sent against events delivered.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";

type Meta = { me: { manage: boolean }; events: { id: string; description: string }[]; scopes: { id: string; description: string }[]; versions: string[] };
type Hook = { id: string; url: string; description: string; events: string[]; enabled: boolean; failures: number; disabledReason: string; createdAt: string };
type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; createdAt: string; deliveredAt: string | null };
type Key = { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };

function useHub<T>(path: string) {
  const { org } = useSession();
  return useQuery({ queryKey: ["hub", org.id, path], queryFn: () => api<T>(`/api/v1/orgs/${org.id}/hub/${path}`) });
}
function useCall() {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  return async <R,>(path: string, method = "POST", body?: unknown, done?: string): Promise<R | null> => {
    try {
      const r = await api<R>(`/api/v1/orgs/${org.id}/hub/${path}`, { method, body: body ?? {} });
      await qc.invalidateQueries({ queryKey: ["hub", org.id] });
      if (done) toast({ tone: "success", title: done });
      return r;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return null;
    }
  };
}

function Secret({ value, what }: { value: string; what: string }) {
  const toast = useToast();
  return (
    <div className="space-y-2">
      <Notice tone="warning">Copy this {what} now — it won&apos;t be shown again.</Notice>
      <div className="flex gap-2"><Input readOnly aria-label={what} value={value} className="font-mono text-[12.5px]" /><Button icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(value).then(() => toast({ tone: "success", title: "Copied" }))}>Copy</Button></div>
    </div>
  );
}

export function HubView() {
  const meta = useHub<Meta>("meta");
  const [tab, setTab] = useState<"webhooks" | "keys" | "work" | "reconcile">("webhooks");
  if (meta.isError) return <ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} />;
  if (!meta.data) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">Connect other systems to this workspace&apos;s ERP data: webhooks tell them when things happen, and the ERP API lets them read and add records. Website and store integrations live in each project.</p>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "webhooks", label: "Webhooks" }, { value: "keys", label: "API keys" }, { value: "work", label: "Background work" }, { value: "reconcile", label: "Reconciliation" }]} />
      {tab === "webhooks" && <Webhooks meta={meta.data} />}
      {tab === "keys" && <Keys meta={meta.data} />}
      {tab === "work" && <Work manage={meta.data.me.manage} />}
      {tab === "reconcile" && <Reconcile />}
    </div>
  );
}

function Webhooks({ meta }: { meta: Meta }) {
  const q = useHub<{ webhooks: Hook[] }>("webhooks");
  const call = useCall();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ url: "", description: "", events: [] as string[] });
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<Hook | null>(null);
  const [del, setDel] = useState<Hook | null>(null);
  if (!q.data) return <Skeleton className="h-40" />;
  const add = async () => {
    const r = await call<{ secret: string }>("webhooks", "POST", f, "Webhook added");
    if (r) {
      setSecret(r.secret);
      setF({ url: "", description: "", events: [] });
    }
  };
  return (
    <div className="space-y-3">
      {meta.me.manage && <Button variant="primary" onClick={() => (setAdding(true), setSecret(null))}>Add a webhook</Button>}
      {!q.data.webhooks.length ? <Card className="p-6 text-center text-[13px] text-muted">No webhooks yet.</Card> : q.data.webhooks.map((w) => (
        <Card key={w.id} className="space-y-1.5 p-4 text-[13.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0"><b className="font-medium break-all">{w.url}</b>{w.description && <span className="text-muted"> · {w.description}</span>}</span>
            <span className="flex items-center gap-2">{w.enabled ? <Badge tone="success">On</Badge> : <Badge tone="danger">Off</Badge>}{meta.me.manage && <Switch checked={w.enabled} onChange={(v) => void call(`webhooks/${w.id}`, "PATCH", { enabled: v }, v ? "Switched on" : "Switched off")} label={`Webhook ${w.url} on`} />}</span>
          </div>
          {w.disabledReason && <p className="text-[12.5px] text-danger">Switched off: {w.disabledReason}</p>}
          <p className="text-[12.5px] text-muted">{w.events.includes("*") ? "Every event" : w.events.join(", ")}{w.failures ? ` · ${w.failures} failed in a row` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setOpen(w)}>Deliveries</Button>
            {meta.me.manage && <><Button size="sm" variant="ghost" onClick={() => void call(`webhooks/${w.id}/test`, "POST", {}, "Test event queued")}>Send a test</Button><Button size="sm" variant="ghost" onClick={async () => { const r = await call<{ secret: string }>(`webhooks/${w.id}/roll`, "POST", {}, "New secret made"); if (r) setSecret(r.secret); }}>New secret</Button><Button size="sm" variant="ghost" onClick={() => setDel(w)}>Delete</Button></>}
          </div>
        </Card>
      ))}
      {secret && !adding && <Card className="p-4"><Secret value={secret} what="signing secret" /></Card>}
      {adding && (
        <Dialog open onClose={() => setAdding(false)} size="lg" title="Add a webhook" description="Each event is POSTed as JSON, signed in the CC-Signature header (t=…,v1=HMAC-SHA256 of “t.body” with the secret). Failed deliveries are retried with backoff; after 25 failures in a row the webhook is switched off." footer={secret ? <Button variant="primary" onClick={() => setAdding(false)}>Done</Button> : <><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!f.url || !f.events.length} onClick={() => void add()}>Add</Button></>}>
          {secret ? <Secret value={secret} what="signing secret" /> : (
            <div className="grid gap-3">
              <Field label="Address (https://…)">{(a) => <Input {...a} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />}</Field>
              <Field label="Description">{(a) => <Input {...a} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
              <div className="grid gap-1.5 text-[13px]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.events.includes("*")} onChange={(e) => setF({ ...f, events: e.target.checked ? ["*"] : [] })} /> Every event</label>
                {!f.events.includes("*") && meta.events.filter((e) => e.id !== "hub.test").map((e) => <label key={e.id} className="flex items-center gap-2"><input type="checkbox" checked={f.events.includes(e.id)} onChange={(x) => setF({ ...f, events: x.target.checked ? [...f.events, e.id] : f.events.filter((y) => y !== e.id) })} /> <code className="text-[12px]">{e.id}</code> <span className="text-muted">— {e.description}</span></label>)}
              </div>
            </div>
          )}
        </Dialog>
      )}
      {open && <DeliveriesDialog hook={open} manage={meta.me.manage} onClose={() => setOpen(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={async () => { if (del) await call(`webhooks/${del.id}`, "DELETE", undefined, "Webhook deleted"); setDel(null); }} destructive title="Delete this webhook?" description="Events stop going to it at once, and its delivery log is removed." confirmLabel="Delete" />
    </div>
  );
}

function DeliveriesDialog({ hook, manage, onClose }: { hook: Hook; manage: boolean; onClose: () => void }) {
  const q = useHub<{ deliveries: Delivery[] }>(`webhooks/${hook.id}/deliveries`);
  const call = useCall();
  return (
    <Dialog open onClose={onClose} size="lg" title="Deliveries" description={hook.url} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {!q.data ? <Skeleton className="h-40" /> : !q.data.deliveries.length ? <p className="text-[13px] text-muted">Nothing sent yet.</p> : (
        <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto text-[13px]">
          {q.data.deliveries.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><code className="text-[12px]">{d.event}</code> <span className="text-muted">· {dateTime(d.createdAt)} · {d.attempts} attempt(s){d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}{d.error ? ` · ${d.error}` : ""}</span></span>
              <span className="flex items-center gap-2"><Badge tone={d.status === "succeeded" ? "success" : d.status === "dead" ? "danger" : d.status === "failed" ? "warning" : "neutral"}>{d.status === "succeeded" ? "Delivered" : d.status === "dead" ? "Gave up" : d.status === "failed" ? "Retrying" : "Waiting"}</Badge>{manage && d.status !== "succeeded" && <Button size="sm" variant="ghost" onClick={() => void call(`deliveries/${d.id}/retry`, "POST", {}, "Sending again")}>Send again</Button>}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function Keys({ meta }: { meta: Meta }) {
  const q = useHub<{ keys: Key[] }>("keys");
  const usage = useHub<{ usage: { name: string | null; status: number; n: number; ms: number }[] }>("usage");
  const call = useCall();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", scopes: [] as string[], expiresInDays: "365" });
  const [key, setKey] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<Key | null>(null);
  if (!q.data) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">The ERP API is at <code>/api/v1/erp</code> — see the <a className="underline" href="/api/v1/erp/openapi.json" target="_blank" rel="noreferrer">OpenAPI description</a>. Send the key as a bearer token; pin a version with the Cloudesk-Version header (current: {meta.versions[0]}). 600 requests a minute per key.</p>
      {meta.me.manage && <Button variant="primary" onClick={() => (setAdding(true), setKey(null))}>Create a key</Button>}
      {!q.data.keys.length ? <Card className="p-6 text-center text-[13px] text-muted">No keys yet.</Card> : (
        <Card className="divide-y divide-border">
          {q.data.keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
              <span className="min-w-0"><b className="font-medium">{k.name}</b> <code className="text-[12px] text-muted">{k.prefix}…</code><span className="block text-[12px] text-muted">{k.scopes.join(", ")} · {k.lastUsedAt ? `last used ${dateTime(k.lastUsedAt)}` : "never used"}{k.expiresAt ? ` · expires ${dateTime(k.expiresAt)}` : ""}</span></span>
              {k.revokedAt ? <Badge>Revoked</Badge> : meta.me.manage && <Button size="sm" variant="ghost" onClick={() => setRevoke(k)}>Revoke</Button>}
            </div>
          ))}
        </Card>
      )}
      {!!usage.data?.usage.length && (
        <Card className="p-4 text-[13px]">
          <p className="mb-1 font-medium">Calls in the last 7 days</p>
          <ul>{usage.data.usage.map((u, i) => <li key={i}>{u.name ?? "Deleted key"} · HTTP {u.status} · {u.n.toLocaleString("en-IN")} calls · {u.ms} ms average</li>)}</ul>
        </Card>
      )}
      {adding && (
        <Dialog open onClose={() => setAdding(false)} title="Create an API key" footer={key ? <Button variant="primary" onClick={() => setAdding(false)}>Done</Button> : <><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!f.name.trim() || !f.scopes.length} onClick={async () => { const r = await call<{ key: string }>("keys", "POST", { name: f.name, scopes: f.scopes, expiresInDays: f.expiresInDays ? Number(f.expiresInDays) : null }, "Key created"); if (r) setKey(r.key); }}>Create</Button></>}>
          {key ? <Secret value={key} what="API key" /> : (
            <div className="grid gap-3">
              <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Warehouse system" />}</Field>
              <div className="grid gap-1.5 text-[13px]">{meta.scopes.map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" checked={f.scopes.includes(s.id)} onChange={(e) => setF({ ...f, scopes: e.target.checked ? [...f.scopes, s.id] : f.scopes.filter((x) => x !== s.id) })} /> <code className="text-[12px]">{s.id}</code> <span className="text-muted">— {s.description}</span></label>)}</div>
              <Field label="Stops working after">{(a) => <Select {...a} value={f.expiresInDays} onChange={(e) => setF({ ...f, expiresInDays: e.target.value })}><option value="30">30 days</option><option value="90">90 days</option><option value="365">A year</option><option value="">Never</option></Select>}</Field>
            </div>
          )}
        </Dialog>
      )}
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(null)} onConfirm={async () => { if (revoke) await call(`keys/${revoke.id}`, "DELETE", undefined, "Key revoked"); setRevoke(null); }} destructive title={`Revoke “${revoke?.name}”?`} description="Anything using it stops working at once." confirmLabel="Revoke" />
    </div>
  );
}

function Work({ manage }: { manage: boolean }) {
  const q = useHub<{ counts: { queued: number; running: number; retrying: number; dead: number; done: number }; problems: { id: string; kind: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; createdAt: string }[]; webhooks: { dead: number; failing: number } }>("jobs");
  const call = useCall();
  if (!q.data) return <Skeleton className="h-40" />;
  const c = q.data.counts;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-5">{([["Waiting", c.queued], ["Running", c.running], ["Retrying", c.retrying], ["Gave up", c.dead], ["Done (24 h)", c.done]] as const).map(([l, v]) => <Card key={l} className="p-4"><p className="text-[12px] text-muted">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p></Card>)}</div>
      <p className="text-[13px] text-muted">Webhook deliveries in the last 7 days: {q.data.webhooks.failing} retrying, {q.data.webhooks.dead} gave up.</p>
      {!q.data.problems.length ? <Card className="p-6 text-center text-[13px] text-muted">Nothing has failed.</Card> : (
        <Card className="divide-y divide-border">
          {q.data.problems.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
              <span className="min-w-0"><code className="text-[12px]">{p.kind}</code> <span className="text-muted">· {dateTime(p.createdAt)} · {p.attempts}/{p.maxAttempts} attempts</span><span className="block break-all text-[12px] text-danger">{p.lastError}</span></span>
              <span className="flex items-center gap-2"><Badge tone={p.status === "dead" ? "danger" : "warning"}>{p.status === "dead" ? "Gave up" : "Retrying"}</Badge>{manage && <Button size="sm" variant="ghost" onClick={() => void call(`jobs/${p.id}/retry`, "POST", {}, "Queued again")}>Retry now</Button>}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Reconcile() {
  const q = useHub<{ days: { day: string; endpoint: string; sent: number; delivered: number; failed: number; pending: number }[] }>("reconciliation");
  if (!q.data) return <Skeleton className="h-40" />;
  if (!q.data.days.length) return <Card className="p-6 text-center text-[13px] text-muted">No events sent in the last 14 days.</Card>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-[13px]">
        <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">Day</th><th className="px-4 py-2.5 font-medium">Webhook</th><th className="px-4 py-2.5 text-right font-medium">Sent</th><th className="px-4 py-2.5 text-right font-medium">Delivered</th><th className="px-4 py-2.5 text-right font-medium">Still trying</th><th className="px-4 py-2.5 text-right font-medium">Gave up</th></tr></thead>
        <tbody className="divide-y divide-border">{q.data.days.map((d) => <tr key={d.day + d.endpoint}><td className="px-4 py-2.5">{d.day}</td><td className="px-4 py-2.5 break-all">{d.endpoint}</td><td className="px-4 py-2.5 text-right tabular-nums">{d.sent}</td><td className="px-4 py-2.5 text-right tabular-nums">{d.delivered}</td><td className="px-4 py-2.5 text-right tabular-nums">{d.pending}</td><td className={`px-4 py-2.5 text-right tabular-nums ${d.failed ? "font-medium text-danger" : ""}`}>{d.failed}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}
