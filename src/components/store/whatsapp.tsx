"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { Badge, Button, ErrorState, Field, IconButton, Input, Notice, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { Panel, storeApi, SubHeader, Table, td, useStoreCtx, useStoreQuery } from "./shared";

type Event = "order_confirmation" | "order_shipped" | "order_delivered" | "cart_reminder";
type Tpl = { name: string; language: string; enabled: boolean };
type Wa = {
  enabled: boolean;
  status: string;
  lastError: string | null;
  connected: boolean;
  hasAppSecret: boolean;
  chatNumber: string;
  displayNumber: string;
  verifiedName: string;
  templates: Partial<Record<Event, Tpl>>;
  webhookUrl: string;
  verifyToken: string;
  guide: Record<Event, { title: string; category: string; body: string; variables: string[] }>;
};
type Msg = { id: string; to: string; event: string; template: string; status: string; error: string | null; createdAt: string };

const EVENTS: Event[] = ["order_confirmation", "order_shipped", "order_delivered", "cart_reminder"];
const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "danger"> = { queued: "neutral", sent: "accent", delivered: "success", read: "success", failed: "danger" };

export function WhatsAppView() {
  const { projectId, can } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<{ whatsapp: Wa; messages: Msg[] }>("integrations/whatsapp");
  const editable = can("secrets:manage");
  const [chat, setChat] = useState<string | null>(null);
  const [creds, setCreds] = useState({ phoneNumberId: "", accessToken: "", appSecret: "" });
  const [tpls, setTpls] = useState<Partial<Record<Event, Tpl>> | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [testTo, setTestTo] = useState("");
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ whatsapp: Wa }>(storeApi(projectId, "integrations/whatsapp"), { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "integrations/whatsapp"] });
      setErrors({});
      setCreds({ phoneNumberId: "", accessToken: "", appSecret: "" });
      toast({ tone: "success", title: "WhatsApp settings saved" });
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      toast({ tone: "error", title: "Could not save", description: errorMessage(e) });
    },
  });
  const test = useMutation({
    mutationFn: (event: Event) => api(storeApi(projectId, "integrations/whatsapp/test"), { method: "POST", body: { to: testTo, event } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "integrations/whatsapp"] });
      toast({ tone: "success", title: "Test message sent", description: "Check WhatsApp on that phone." });
    },
    onError: (e) => toast({ tone: "error", title: "Test failed", description: errorMessage(e) }),
  });

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const w = q.data.whatsapp;
  const t = tpls ?? w.templates;
  const setTpl = (e: Event, patch: Partial<Tpl>) => setTpls({ ...t, [e]: { name: "", language: "en", enabled: false, ...t[e], ...patch } });
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast({ tone: "success", title: "Copied" }));

  return (
    <div>
      <SubHeader title="WhatsApp" description="Let shoppers message you, and send order updates where your customers actually read them." />
      {!editable && (
        <div className="mb-4">
          <Notice title="View only">Only project owners and admins can change WhatsApp settings.</Notice>
        </div>
      )}
      <fieldset disabled={!editable} className="space-y-4">
        <Panel title="1. Click-to-chat" description="Adds “Ask about this on WhatsApp” to product pages and a chat link on order pages. Works with any WhatsApp or WhatsApp Business number — no setup with Meta needed.">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ chatNumber: chat ?? w.chatNumber });
            }}
          >
            <Field label="Your WhatsApp number" error={errors.chatNumber?.[0]} className="min-w-[240px] flex-1">
              {(a) => <Input {...a} value={chat ?? (w.chatNumber ? `+${w.chatNumber}` : "")} onChange={(e) => setChat(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" />}
            </Field>
            <Button type="submit" variant="primary" loading={save.isPending && "chatNumber" in (save.variables ?? {})}>
              Save
            </Button>
          </form>
        </Panel>

        <Panel
          title="2. Automatic messages (WhatsApp Cloud API)"
          description="Order confirmations, shipping and delivery updates, and cart reminders — sent only to shoppers who tick “Send me order updates on WhatsApp” at checkout."
          actions={
            <>
              {w.connected ? <Badge tone="success">Connected{w.displayNumber ? ` · ${w.displayNumber}` : ""}</Badge> : <Badge>Not connected</Badge>}
              <Switch checked={w.enabled} disabled={!editable || !w.connected || save.isPending} onChange={(v) => save.mutate({ enabled: v })} label="Send automatic messages" />
            </>
          }
        >
          <div className="space-y-4">
            {w.connected && w.verifiedName && <p className="text-[13px] text-muted">Sending as “{w.verifiedName}”.</p>}
            {w.lastError && <Notice tone="danger">{w.lastError}</Notice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone number ID" hint={w.connected ? "Saved — leave blank to keep" : "WhatsApp Manager → API setup"} error={errors.phoneNumberId?.[0]}>
                {(a) => <Input {...a} value={creds.phoneNumberId} onChange={(e) => setCreds({ ...creds, phoneNumberId: e.target.value.trim() })} className="font-mono text-xs" inputMode="numeric" />}
              </Field>
              <Field label="Permanent access token" hint={w.connected ? "Saved — leave blank to keep" : "From a system user with whatsapp_business_messaging"} error={errors.accessToken?.[0]}>
                {(a) => <Input {...a} type="password" autoComplete="off" value={creds.accessToken} onChange={(e) => setCreds({ ...creds, accessToken: e.target.value })} className="font-mono text-xs" />}
              </Field>
            </div>
            <Field label="App secret (for delivery receipts)" hint={w.hasAppSecret ? "Saved — leave blank to keep" : "Optional. App dashboard → Settings → Basic. Needed to accept delivery and read receipts."}>
              {(a) => <Input {...a} type="password" autoComplete="off" value={creds.appSecret} onChange={(e) => setCreds({ ...creds, appSecret: e.target.value })} className="font-mono text-xs" />}
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" disabled={!creds.phoneNumberId && !creds.accessToken && !creds.appSecret} loading={save.isPending && "accessToken" in (save.variables ?? {})} onClick={() => save.mutate({ ...(creds.phoneNumberId ? { phoneNumberId: creds.phoneNumberId } : {}), ...(creds.accessToken ? { accessToken: creds.accessToken } : {}), ...(creds.appSecret ? { appSecret: creds.appSecret } : {}) })}>
                {w.connected ? "Update connection" : "Connect"}
              </Button>
            </div>
            <div className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px]">
              <p className="font-medium">Webhook (optional, for delivery receipts)</p>
              <p className="mt-0.5 text-xs text-muted">In your Meta app → WhatsApp → Configuration, set this callback URL and verify token, and subscribe to “messages”.</p>
              {[["Callback URL", w.webhookUrl], ["Verify token", w.verifyToken]].map(([label, value]) => (
                <div key={label} className="mt-2 flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-muted">{label}</span>
                  <Input readOnly value={value} className="font-mono text-xs" aria-label={label} />
                  <IconButton label={`Copy ${label.toLowerCase()}`} icon={<Copy className="size-3.5" />} onClick={() => copy(value)} />
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="3. Message templates" description="WhatsApp only allows business-started messages from templates Meta has approved. Create each one in WhatsApp Manager with the text below (you can reword it, keeping the {{variables}} in the same order), then enter its name here.">
          <div className="space-y-4">
            {EVENTS.map((e) => {
              const g = w.guide[e];
              const cur = t[e] ?? { name: "", language: "en", enabled: false };
              return (
                <div key={e} className="rounded-[var(--radius-md)] border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold">
                      {g.title} <Badge>{g.category === "MARKETING" ? "Marketing" : "Utility"}</Badge>
                    </p>
                    <Switch checked={cur.enabled} onChange={(v) => setTpl(e, { enabled: v })} label={`Send ${g.title.toLowerCase()}`} />
                  </div>
                  <div className="mt-2 flex items-start gap-2 rounded-[var(--radius-sm)] bg-surface-2 p-2 text-xs">
                    <p className="flex-1 font-mono whitespace-pre-wrap">{g.body}</p>
                    <IconButton size="sm" label="Copy template text" icon={<Copy className="size-3.5" />} onClick={() => copy(g.body)} />
                  </div>
                  <p className="mt-1 text-[11px] text-subtle">Variables: {g.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(" · ")}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px]">
                    <Input aria-label={`${g.title} template name`} placeholder="template_name" value={cur.name} onChange={(ev) => setTpl(e, { name: ev.target.value.trim() })} className="font-mono text-xs" />
                    <Input aria-label={`${g.title} language`} placeholder="en" value={cur.language} onChange={(ev) => setTpl(e, { language: ev.target.value.trim() })} className="font-mono text-xs" />
                  </div>
                  {errors[`templates.${e}`] && <p className="mt-1 text-xs text-danger">{errors[`templates.${e}`][0]}</p>}
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button variant="primary" disabled={!tpls} loading={save.isPending && "templates" in (save.variables ?? {})} onClick={() => save.mutate({ templates: Object.fromEntries(Object.entries(t).filter(([, v]) => v && v.name)) })}>
                Save templates
              </Button>
            </div>
            {w.connected && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
                <Field label="Send a test to" className="min-w-[200px] flex-1">
                  {(a) => <Input {...a} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" />}
                </Field>
                <Button icon={<Send className="size-3.5" />} disabled={!testTo || !t.order_confirmation?.name} loading={test.isPending} onClick={() => test.mutate("order_confirmation")}>
                  Send order confirmation test
                </Button>
              </div>
            )}
          </div>
        </Panel>
      </fieldset>

      <h2 className="mt-8 mb-3 text-sm font-semibold">Recent messages</h2>
      <Table head={["To", "Message", "Status", "When"]} empty={q.data.messages.length === 0 && <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted"><MessageCircle className="size-4" /> No WhatsApp messages sent yet.</p>}>
        {q.data.messages.map((m) => (
          <tr key={m.id}>
            <td className={`${td} font-mono text-xs`}>+{m.to}</td>
            <td className={td}>
              {w.guide[m.event as Event]?.title ?? (m.event === "test" ? "Test" : m.event)} <span className="text-xs text-muted">({m.template})</span>
            </td>
            <td className={td}>
              <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
              {m.error && <span className="block max-w-xs truncate text-xs text-danger" title={m.error}>{m.error}</span>}
            </td>
            <td className={`${td} text-muted`}>{timeAgo(m.createdAt)}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 flex items-center gap-1 text-xs text-muted">
        Meta charges per conversation for template messages.{" "}
        <a href="https://developers.facebook.com/docs/whatsapp/pricing" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
          Pricing <ExternalLink className="size-3" />
        </a>
      </p>
    </div>
  );
}
