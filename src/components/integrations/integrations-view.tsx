"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Boxes, CheckCircle2, Copy, CreditCard, FileCode2, Globe, KeyRound, Mail, MessageCircle, Plus, Puzzle, RefreshCw, Send, Trash2, Truck, Webhook, XCircle, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Notice, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { useProject } from "@/lib/client/use-project";

type Integration = { id: string; kind: string; enabled: boolean; settings: { events?: string[]; listId?: string; doubleOptIn?: boolean; sources?: string[] }; lastError: string | null; lastUsedAt: string | null; hint: string };
type Endpoint = { id: string; url: string; description: string; events: string[]; enabled: boolean; appInstallId: string | null; createdAt: string };
type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; appInstallId: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type Manifest = { name: string; slug: string; version: string; description: string; author: string; icon: string; scopes: string[]; events: string[]; webhookUrl?: string; installUrl?: string; configFields: { key: string; label: string; type: "text" | "secret" | "select" | "boolean"; required: boolean; options?: string[]; help?: string }[] };
type App = { id: string; manifest: Manifest; install: { id: string; scopes: string[]; createdAt: string } | null };
type Data = { integrations: Integration[]; webhooks: Endpoint[]; apiKeys: ApiKey[]; apps: App[]; events: { id: string; description: string }[]; scopes: { id: string; description: string }[] };
type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; responseBody: string | null; error: string | null; createdAt: string };

/** A monochrome tile with the service's initial: no third-party logos. */
function Tile({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-[#3a3a3c] to-black text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] dark:from-[#e5e5ea] dark:to-[#8e8e93] dark:text-black">{icon ?? label.slice(0, 1)}</span>;
}

function OneTime({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <div className="grid gap-2">
      <Notice tone="warning" title={`Copy the ${label} now`}>
        It won&apos;t be shown again. Store it somewhere safe.
      </Notice>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={label} />
        <Button icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(value).then(() => toast({ tone: "success", title: "Copied" }))}>
          Copy
        </Button>
      </div>
    </div>
  );
}

function EventPicker({ events, value, onChange }: { events: Data["events"]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-[13px] font-medium">Events</legend>
      {events.map((e) => (
        <label key={e.id} className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-0.5" checked={value.includes(e.id)} onChange={(x) => onChange(x.target.checked ? [...value, e.id] : value.filter((v) => v !== e.id))} />
          <span>
            <code className="font-mono text-xs">{e.id}</code> <span className="text-muted">— {e.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const CONNECTORS: { kind: "slack" | "discord" | "telegram" | "mailchimp"; name: string; blurb: string; fields: { key: string; label: string; placeholder: string; help?: string; secret?: boolean; setting?: boolean }[]; notify: boolean }[] = [
  { kind: "slack", name: "Slack", blurb: "Post new orders, leads and bookings to a channel.", notify: true, fields: [{ key: "webhookUrl", label: "Incoming-webhook URL", placeholder: "https://hooks.slack.com/services/…", help: "In Slack: Apps → Incoming Webhooks → Add to a channel.", secret: true }] },
  { kind: "discord", name: "Discord", blurb: "Notifications in a Discord channel.", notify: true, fields: [{ key: "webhookUrl", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…", help: "Channel settings → Integrations → Webhooks → New webhook.", secret: true }] },
  {
    kind: "telegram",
    name: "Telegram",
    blurb: "Messages from your own bot to you or a group.",
    notify: true,
    fields: [
      { key: "botToken", label: "Bot token", placeholder: "123456:ABC…", help: "Create a bot with @BotFather.", secret: true },
      { key: "chatId", label: "Chat id", placeholder: "-1001234567890 or @channel", help: "Add the bot to the chat; @userinfobot shows the id." },
    ],
  },
  {
    kind: "mailchimp",
    name: "Mailchimp",
    blurb: "Add newsletter sign-ups and consenting customers to an audience.",
    notify: false,
    fields: [
      { key: "apiKey", label: "API key", placeholder: "xxxxxxxx-us21", help: "Profile → Extras → API keys.", secret: true },
      { key: "listId", label: "Audience id", placeholder: "a1b2c3d4e5", help: "Audience → Settings → Audience name and defaults.", setting: true },
    ],
  },
];

function ConnectDialog({ projectId, c, events, onClose }: { projectId: string; c: (typeof CONNECTORS)[number]; events: Data["events"]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [ev, setEv] = useState<string[]>(["order.paid", "form.submitted", "booking.confirmed"]);
  const [doubleOptIn, setDoubleOptIn] = useState(true);
  const connect = useMutation({
    mutationFn: () => {
      const creds = Object.fromEntries(c.fields.filter((f) => !f.setting).map((f) => [f.key, vals[f.key] ?? ""]));
      const settings = c.kind === "mailchimp" ? { listId: vals.listId ?? "", doubleOptIn } : { events: ev };
      return api(`/api/v1/projects/${projectId}/integrations/connect/${c.kind}`, { method: "POST", body: { creds, settings } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations", projectId] });
      toast({ tone: "success", title: `${c.name} connected`, description: c.kind === "slack" || c.kind === "telegram" ? "We sent a test message." : undefined });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Connect ${c.name}`}
      description={c.blurb}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>
            Connect
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {connect.error && <Notice tone="danger">{errorMessage(connect.error)}</Notice>}
        {c.fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.help}>
            {(p) => <Input {...p} type={f.secret ? "password" : "text"} placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} autoComplete="off" />}
          </Field>
        ))}
        {c.notify && <EventPicker events={events} value={ev} onChange={setEv} />}
        {c.kind === "mailchimp" && (
          <>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={doubleOptIn} onChange={(e) => setDoubleOptIn(e.target.checked)} /> Double opt-in (Mailchimp emails a confirmation first)
            </label>
            <p className="text-xs text-muted">Newsletter sign-ups are added; customers only if they ticked &ldquo;email me offers&rdquo; at checkout.</p>
          </>
        )}
        <p className="text-xs text-subtle">Credentials are checked with {c.name} and stored encrypted.</p>
      </div>
    </Dialog>
  );
}

function AutomationGuide({ name, onClose, projectId }: { name: string; onClose: () => void; projectId: string }) {
  return (
    <Dialog open onClose={onClose} title={`Use ${name}`} description={`${name} connects through webhooks and the public API — no extra install needed.`} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <ol className="grid list-decimal gap-3 pl-5 text-[13px]">
        <li>
          <strong>Triggers:</strong> in {name}, create a &ldquo;Webhook / Catch hook&rdquo; trigger and copy its URL. Add it under the <em>Webhooks</em> tab here and choose the events (e.g. <code>order.paid</code>).
        </li>
        <li>
          <strong>Actions:</strong> create an API key under <em>API keys</em> with only the permissions the automation needs, and call the{" "}
          <a className="underline" href="/api/public/v1/openapi.json" target="_blank" rel="noreferrer">
            public API
          </a>{" "}
          with <code>Authorization: Bearer cc_live_…</code>.
        </li>
        <li>
          <strong>Verify:</strong> each delivery has a <code>CC-Signature</code> header you can check with the webhook&apos;s secret.
        </li>
      </ol>
      <p className="mt-3 text-xs text-muted">
        Prefer to keep it inside the platform? <Link href={`/projects/${projectId}/automations`} className="underline">Automations</Link> handle many of the same jobs without an external service.
      </p>
    </Dialog>
  );
}

function CatalogTab({ projectId, data, goto }: { projectId: string; data: Data; goto: (t: "webhooks" | "keys" | "apps") => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [connecting, setConnecting] = useState<(typeof CONNECTORS)[number] | null>(null);
  const [guide, setGuide] = useState<string | null>(null);
  const patch = useMutation({ mutationFn: ({ kind, enabled }: { kind: string; enabled: boolean }) => api(`/api/v1/projects/${projectId}/integrations/connect/${kind}`, { method: "PATCH", body: { enabled } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", projectId] }) });
  const remove = useMutation({
    mutationFn: (kind: string) => api(`/api/v1/projects/${projectId}/integrations/connect/${kind}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", projectId] }),
    onError: (e) => toast({ tone: "error", title: "Could not disconnect", description: errorMessage(e) }),
  });
  const linkCards: { name: string; blurb: string; href: string; icon: React.ReactNode }[] = [
    { name: "Payments", blurb: "Razorpay, Stripe and PayPal checkout.", href: `/projects/${projectId}/store/payments`, icon: <CreditCard className="size-4" /> },
    { name: "Shiprocket", blurb: "Courier booking, labels and tracking (India).", href: `/projects/${projectId}/store/shipping`, icon: <Truck className="size-4" /> },
    { name: "WhatsApp", blurb: "Click-to-chat and order updates.", href: `/projects/${projectId}/store/whatsapp`, icon: <MessageCircle className="size-4" /> },
    { name: "Custom domain", blurb: "Serve the site on your own domain.", href: `/projects/${projectId}/deployments`, icon: <Globe className="size-4" /> },
  ];
  return (
    <div className="grid gap-8">
      <section>
        <h2 className="mb-3 text-[13px] font-semibold text-muted">Notifications and audiences</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CONNECTORS.map((c) => {
            const i = data.integrations.find((x) => x.kind === c.kind);
            return (
              <Card key={c.kind} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <Tile label={c.name} />
                  {i && <Switch label={`${i.enabled ? "Pause" : "Resume"} ${c.name}`} checked={i.enabled} onChange={(v) => patch.mutate({ kind: c.kind, enabled: v })} />}
                </div>
                <p className="mt-3 text-[14px] font-semibold">{c.name}</p>
                <p className="mt-0.5 flex-1 text-[13px] text-muted">{c.blurb}</p>
                {i?.lastError && <p className="mt-2 text-xs text-danger">{i.lastError}</p>}
                <div className="mt-3 flex items-center justify-between gap-2">
                  {i ? (
                    <>
                      <span className="text-xs text-muted">{i.lastUsedAt ? `Used ${timeAgo(i.lastUsedAt)}` : "Connected"}</span>
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.kind)}>
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => setConnecting(c)}>
                      Connect
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-[13px] font-semibold text-muted">Automation platforms</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {["Zapier", "Make", "n8n"].map((n) => (
            <Card key={n} className="flex items-center gap-3 p-4">
              <Tile label={n} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{n}</p>
                <p className="text-xs text-muted">Webhooks in, API out.</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setGuide(n)}>
                Set up
              </Button>
            </Card>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-[13px] font-semibold text-muted">Already built in</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {linkCards.map((l) => (
            <Link key={l.name} href={l.href} className="glass-card group flex items-center gap-3 rounded-[var(--radius-xl)] p-4 hover:bg-surface-solid">
              <Tile label={l.name} icon={l.icon} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">{l.name}</span>
                <span className="block text-xs text-muted">{l.blurb}</span>
              </span>
              <ArrowUpRight className="size-4 text-subtle group-hover:text-fg" aria-hidden />
            </Link>
          ))}
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { t: "webhooks" as const, icon: <Webhook className="size-4" />, title: "Webhooks", body: "Signed events to your own servers." },
          { t: "keys" as const, icon: <KeyRound className="size-4" />, title: "API keys", body: "Read and update the store from your code." },
          { t: "apps" as const, icon: <Puzzle className="size-4" />, title: "Build an app", body: "Package an integration with the SDK." },
        ].map((x) => (
          <button key={x.t} onClick={() => goto(x.t)} className="glass-card flex items-center gap-3 rounded-[var(--radius-xl)] p-4 text-left hover:bg-surface-solid">
            <Tile label={x.title} icon={x.icon} />
            <span>
              <span className="block text-[14px] font-semibold">{x.title}</span>
              <span className="block text-xs text-muted">{x.body}</span>
            </span>
          </button>
        ))}
      </section>
      {connecting && <ConnectDialog projectId={projectId} c={connecting} events={data.events} onClose={() => setConnecting(null)} />}
      {guide && <AutomationGuide name={guide} projectId={projectId} onClose={() => setGuide(null)} />}
    </div>
  );
}

function Deliveries({ projectId, endpointId }: { projectId: string; endpointId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["deliveries", endpointId], queryFn: () => api<{ deliveries: Delivery[] }>(`/api/v1/projects/${projectId}/integrations/webhooks/${endpointId}/deliveries`), refetchInterval: 4000 });
  const again = useMutation({ mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/integrations/deliveries/${id}/redeliver`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["deliveries", endpointId] }) });
  if (!q.data) return <Skeleton className="h-16" />;
  if (!q.data.deliveries.length) return <p className="py-3 text-xs text-muted">No deliveries yet. Send a test event.</p>;
  return (
    <ul className="divide-y divide-border text-[13px]">
      {q.data.deliveries.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
          {d.status === "succeeded" ? <CheckCircle2 className="size-4 text-success" /> : d.status === "pending" ? <RefreshCw className="size-4 text-muted" /> : <XCircle className="size-4 text-danger" />}
          <code className="font-mono text-xs">{d.event}</code>
          <span className="text-xs text-muted">
            {d.responseStatus ? `HTTP ${d.responseStatus}` : d.error ?? d.status} · {d.attempts} {d.attempts === 1 ? "attempt" : "attempts"}
          </span>
          <span className="ml-auto text-xs text-subtle" title={dateTime(d.createdAt)}>
            {timeAgo(d.createdAt)}
          </span>
          {d.status !== "succeeded" && d.status !== "pending" && (
            <Button size="sm" variant="ghost" onClick={() => again.mutate(d.id)}>
              Resend
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function WebhooksTab({ projectId, data }: { projectId: string; data: Data }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("https://");
  const [desc, setDesc] = useState("");
  const [ev, setEv] = useState<string[]>(["order.paid"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Endpoint | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations", projectId] });
  const add = useMutation({
    mutationFn: () => api<{ id: string; secret: string }>(`/api/v1/projects/${projectId}/integrations/webhooks`, { method: "POST", body: { url, description: desc, events: ev } }),
    onSuccess: (r) => {
      setAdding(false);
      setSecret(r.secret);
      setOpen(r.id);
      refresh();
    },
  });
  const test = useMutation({ mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/integrations/webhooks/${id}/test`, { method: "POST", body: {} }), onSuccess: (_r, id) => qc.invalidateQueries({ queryKey: ["deliveries", id] }) });
  const roll = useMutation({ mutationFn: (id: string) => api<{ secret: string }>(`/api/v1/projects/${projectId}/integrations/webhooks/${id}/roll`, { method: "POST", body: {} }), onSuccess: (r) => setSecret(r.secret) });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/v1/projects/${projectId}/integrations/webhooks/${id}`, { method: "PATCH", body: { enabled } }), onSuccess: refresh });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/integrations/webhooks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete", description: errorMessage(e) }),
  });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-muted">Each delivery is signed (<code className="font-mono">CC-Signature</code>), retried for about a day when your server doesn&apos;t answer 2xx, and logged below. Answer 410 to switch an endpoint off.</p>
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
          Add endpoint
        </Button>
      </div>
      {data.webhooks.length === 0 ? (
        <Card>
          <EmptyState icon={<Webhook className="size-5" />} title="No webhook endpoints" description="Send order, form and booking events to your own servers or to Zapier, Make and n8n." />
        </Card>
      ) : (
        data.webhooks.map((e) => (
          <Card key={e.id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Switch label={e.enabled ? "Switch off" : "Switch on"} checked={e.enabled} onChange={(v) => toggle.mutate({ id: e.id, enabled: v })} />
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <p className="truncate font-mono text-[13px]">{e.url}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {e.description || (e.appInstallId ? "Used by an app" : "")} {e.description ? "· " : ""}
                  {e.events.join(", ")}
                </p>
              </button>
              {e.appInstallId && <Badge>App</Badge>}
              <Button size="sm" icon={<Send className="size-3.5" />} loading={test.isPending && test.variables === e.id} onClick={() => test.mutate(e.id)}>
                Send test
              </Button>
              {!e.appInstallId && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => roll.mutate(e.id)}>
                    New secret
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Delete endpoint" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(e)} />
                </>
              )}
            </div>
            {open === e.id && (
              <div className="mt-3 border-t border-border pt-3">
                <Deliveries projectId={projectId} endpointId={e.id} />
              </div>
            )}
          </Card>
        ))
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a webhook endpoint"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" loading={add.isPending} onClick={() => add.mutate()}>
              Add
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {add.error && <Notice tone="danger">{errorMessage(add.error)}</Notice>}
          <Field label="URL" hint="Public https addresses only.">{(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-xs" />}</Field>
          <Field label="Description (optional)">{(p) => <Input {...p} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="ERP order sync" />}</Field>
          <EventPicker events={data.events} value={ev} onChange={setEv} />
        </div>
      </Dialog>
      <Dialog open={!!secret} onClose={() => setSecret(null)} title="Signing secret" footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}>
        {secret && <OneTime value={secret} label="signing secret" />}
      </Dialog>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && del.mutate(removing.id)} loading={del.isPending} destructive title="Delete this endpoint?" description="Deliveries stop immediately and its log is deleted." confirmLabel="Delete" />
    </div>
  );
}

function KeysTab({ projectId, data }: { projectId: string; data: Data }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["orders:read"]);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const add = useMutation({
    mutationFn: () => api<{ key: string }>(`/api/v1/projects/${projectId}/integrations/keys`, { method: "POST", body: { name, scopes } }),
    onSuccess: (r) => {
      setAdding(false);
      setName("");
      setCreated(r.key);
      qc.invalidateQueries({ queryKey: ["integrations", projectId] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/integrations/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ["integrations", projectId] });
    },
  });
  const live = data.apiKeys.filter((k) => !k.revokedAt);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-muted">
          Keys reach this project only, with the permissions you choose. Send <code className="font-mono">Authorization: Bearer cc_live_…</code> to <code className="font-mono">/api/public/v1</code>.{" "}
          <a className="inline-flex items-center gap-0.5 underline" href="/api/public/v1/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI document <FileCode2 className="size-3" />
          </a>
        </p>
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
          Create key
        </Button>
      </div>
      {live.length === 0 ? (
        <Card>
          <EmptyState icon={<KeyRound className="size-5" />} title="No API keys" description="Create a key to read orders or update stock from your own code, a spreadsheet script or an ERP." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Permissions</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {live.map((k) => (
                <tr key={k.id}>
                  <td className="px-4 py-2 font-medium">
                    {k.name} {k.appInstallId && <Badge>App</Badge>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{k.prefix}…</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : "Never"}</td>
                  <td className="px-4 py-2 text-right">{!k.appInstallId && <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>Revoke</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Create an API key"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" loading={add.isPending} disabled={!name.trim() || !scopes.length} onClick={() => add.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {add.error && <Notice tone="danger">{errorMessage(add.error)}</Notice>}
          <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Warehouse sync" />}</Field>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-[13px] font-medium">Permissions</legend>
            {data.scopes.map((s) => (
              <label key={s.id} className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" className="mt-0.5" checked={scopes.includes(s.id)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))} />
                <span>
                  <code className="font-mono text-xs">{s.id}</code> <span className="text-muted">— {s.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </Dialog>
      <Dialog open={!!created} onClose={() => setCreated(null)} title="Your new API key" footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
        {created && <OneTime value={created} label="API key" />}
      </Dialog>
      <ConfirmDialog open={!!revoking} onClose={() => setRevoking(null)} onConfirm={() => revoking && revoke.mutate(revoking.id)} loading={revoke.isPending} destructive title={`Revoke “${revoking?.name}”?`} description="Anything using this key stops working immediately." confirmLabel="Revoke" />
    </div>
  );
}

const SAMPLE_MANIFEST = `{
  "name": "Stock Sync",
  "slug": "stock-sync",
  "description": "Keeps stock in step with our warehouse.",
  "icon": "📦",
  "scopes": ["products:read", "products:write"],
  "events": ["order.paid"],
  "webhookUrl": "https://stock-sync.example.com/events",
  "installUrl": "https://stock-sync.example.com/install",
  "configFields": [{ "key": "warehouse", "label": "Warehouse code", "type": "text", "required": true }]
}`;

function AppsTab({ projectId, data }: { projectId: string; data: Data }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useSession();
  const [registering, setRegistering] = useState(false);
  const [manifest, setManifest] = useState(SAMPLE_MANIFEST);
  const [secret, setSecret] = useState<string | null>(null);
  const [installing, setInstalling] = useState<App | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations", projectId] });
  const register = useMutation({
    mutationFn: () => api<{ id: string; secret: string }>(`/api/v1/orgs/${org.id}/apps`, { method: "POST", body: JSON.parse(manifest) }),
    onSuccess: (r) => {
      setRegistering(false);
      setSecret(r.secret);
      refresh();
    },
  });
  const install = useMutation({
    mutationFn: (a: App) => api(`/api/v1/projects/${projectId}/integrations/apps/${a.id}/install`, { method: "POST", body: { config } }),
    onSuccess: () => {
      setInstalling(null);
      setConfig({});
      refresh();
      toast({ tone: "success", title: "App installed" });
    },
  });
  const uninstall = useMutation({ mutationFn: (a: App) => api(`/api/v1/projects/${projectId}/integrations/apps/${a.id}/install`, { method: "DELETE" }), onSuccess: refresh });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-muted">
          Apps package an integration: a manifest asks for API permissions and events; installing hands the app a key and a signed event feed. Build one with <code className="font-mono">@creation-cloud/sdk</code> (see <code className="font-mono">packages/sdk</code>).
        </p>
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setRegistering(true)}>
          Register an app
        </Button>
      </div>
      {data.apps.length === 0 ? (
        <Card>
          <EmptyState icon={<Boxes className="size-5" />} title="No apps yet" description="Apps your organization registers appear here, ready to install into any of its projects." />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.apps.map((a) => (
            <Card key={a.id} className="flex flex-col p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-[12px] bg-surface-2 text-xl">{a.manifest.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">
                    {a.manifest.name} <span className="font-normal text-subtle">v{a.manifest.version}</span>
                  </p>
                  <p className="truncate text-xs text-muted">{a.manifest.description || a.manifest.slug}</p>
                </div>
                {a.install ? <Badge tone="success">Installed</Badge> : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {a.manifest.scopes.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
                {a.manifest.events.map((e) => (
                  <Badge key={e} tone="accent">
                    {e}
                  </Badge>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                {a.install ? (
                  <Button size="sm" variant="ghost" loading={uninstall.isPending} onClick={() => uninstall.mutate(a)}>
                    Uninstall
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setInstalling(a)}>
                    Install
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={registering}
        onClose={() => setRegistering(false)}
        size="lg"
        title="Register an app"
        description="Paste the app's manifest (JSON). Your organization can then install it into any project."
        footer={
          <>
            <Button onClick={() => setRegistering(false)}>Cancel</Button>
            <Button variant="primary" loading={register.isPending} onClick={() => register.mutate()}>
              Register
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {register.error && <Notice tone="danger">{register.error instanceof SyntaxError ? "That isn't valid JSON" : errorMessage(register.error)}</Notice>}
          <Textarea rows={16} className="font-mono text-xs" value={manifest} onChange={(e) => setManifest(e.target.value)} aria-label="Manifest" />
        </div>
      </Dialog>
      <Dialog open={!!secret} onClose={() => setSecret(null)} title="App secret" description="Your app uses it to verify the install hand-off." footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}>
        {secret && <OneTime value={secret} label="app secret" />}
      </Dialog>
      {installing && (
        <Dialog
          open
          onClose={() => setInstalling(null)}
          title={`Install ${installing.manifest.name}?`}
          footer={
            <>
              <Button onClick={() => setInstalling(null)}>Cancel</Button>
              <Button variant="primary" loading={install.isPending} onClick={() => install.mutate(installing)}>
                Install
              </Button>
            </>
          }
        >
          <div className="grid gap-4 text-[13px]">
            {install.error && <Notice tone="danger">{errorMessage(install.error)}</Notice>}
            <div>
              <p className="font-medium">It will be able to:</p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {installing.manifest.scopes.map((s) => (
                  <li key={s}>{data.scopes.find((x) => x.id === s)?.description ?? s}</li>
                ))}
                {installing.manifest.events.length > 0 && <li>Receive these events: {installing.manifest.events.join(", ")}</li>}
                {!installing.manifest.scopes.length && !installing.manifest.events.length && <li>Nothing beyond its settings</li>}
              </ul>
            </div>
            {installing.manifest.configFields.map((f) =>
              f.type === "boolean" ? (
                <label key={f.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={!!config[f.key]} onChange={(e) => setConfig({ ...config, [f.key]: e.target.checked })} /> {f.label}
                </label>
              ) : f.type === "select" ? (
                <Field key={f.key} label={f.label} hint={f.help}>
                  {(p) => (
                    <select {...p} className="h-9 rounded-[var(--radius-md)] border border-border bg-surface px-3" value={String(config[f.key] ?? "")} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}>
                      <option value="">Choose…</option>
                      {f.options?.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : (
                <Field key={f.key} label={`${f.label}${f.required ? "" : " (optional)"}`} hint={f.help}>
                  {(p) => <Input {...p} type={f.type === "secret" ? "password" : "text"} value={String(config[f.key] ?? "")} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />}
                </Field>
              ),
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function IntegrationsView({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const can = project.data?.permissions.includes("integrations:manage");
  const q = useQuery({ queryKey: ["integrations", projectId], queryFn: () => api<Data>(`/api/v1/projects/${projectId}/integrations`), enabled: !!can });
  const [tab, setTab] = useState<"catalog" | "webhooks" | "keys" | "apps">("catalog");
  if (project.data && !can) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <EmptyState icon={<Zap className="size-5" />} title="Integrations are managed by owners, admins and developers" />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="title-xl">Integrations</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] text-muted">Connect the tools you already use, send events to your own systems, and build on the public API.</p>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { value: "catalog", label: "Catalog" },
          { value: "webhooks", label: <><Webhook className="size-3.5" /> Webhooks</> },
          { value: "keys", label: <><KeyRound className="size-3.5" /> API keys</> },
          { value: "apps", label: <><Puzzle className="size-3.5" /> Apps</> },
        ]}
      />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-64" />
      ) : tab === "catalog" ? (
        <CatalogTab projectId={projectId} data={q.data} goto={setTab} />
      ) : tab === "webhooks" ? (
        <WebhooksTab projectId={projectId} data={q.data} />
      ) : tab === "keys" ? (
        <KeysTab projectId={projectId} data={q.data} />
      ) : (
        <AppsTab projectId={projectId} data={q.data} />
      )}
      <p className={cx("mt-8 flex items-center gap-1.5 text-xs text-subtle")}>
        <Mail className="size-3.5" aria-hidden /> Email delivery is configured by the platform administrator (Resend, Postmark, SendGrid or SMTP).
      </p>
    </div>
  );
}
