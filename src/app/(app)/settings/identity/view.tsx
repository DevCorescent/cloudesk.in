"use client";

// Identity: single sign-on with the workspace's identity provider (OIDC),
// the email domains it has proven it owns, the SCIM token for provisioning,
// and members' sign-ins.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";

type Sso = { connection: { issuer: string; clientId: string; enabled: boolean; enforce: boolean; jitRole: string; lastLoginAt: string | null; hasSecret: boolean } | null; domains: { id: string; domain: string; verifiedAt: string | null; record: { name: string; value: string } }[]; redirectUri: string; scim: { token: { prefix: string; createdAt: string; lastUsedAt: string | null } | null; baseUrl: string } };
type Logins = { events: { name: string; email: string; ok: boolean; method: string; reason: string; ip: string | null; newDevice: boolean; at: string }[]; attention: { email: string; failures: number }[] };

function Copyable({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return <div className="flex gap-2"><Input readOnly aria-label={label} value={value} className="font-mono text-[12.5px]" /><Button icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(value).then(() => toast({ tone: "success", title: "Copied" }))}>Copy</Button></div>;
}

export function IdentityView() {
  const { org } = useSession();
  const [tab, setTab] = useState<"sso" | "logins">("sso");
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "sso", label: "Single sign-on & SCIM" }, { value: "logins", label: "Members' sign-ins" }]} />
      {tab === "sso" ? <SsoTab orgId={org.id} /> : <LoginsTab orgId={org.id} />}
    </div>
  );
}

function SsoTab({ orgId }: { orgId: string }) {
  const base = `/api/v1/orgs/${orgId}/identity`;
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["identity", orgId], queryFn: () => api<Sso>(`${base}/sso`) });
  const [f, setF] = useState<{ issuer: string; clientId: string; clientSecret: string; enabled: boolean; enforce: boolean; jitRole: string } | null>(null);
  const [domain, setDomain] = useState("");
  const [scimToken, setScimToken] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  const run = async (path: string, method: string, body?: unknown, done?: string) => {
    try {
      const r = await api<Record<string, unknown>>(`${base}/${path}`, { method, body: body ?? {} });
      await qc.invalidateQueries({ queryKey: ["identity", orgId] });
      if (done) toast({ tone: "success", title: done });
      return r;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return null;
    }
  };
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-60" />;
  const c = q.data.connection;
  const v = f ?? { issuer: c?.issuer ?? "", clientId: c?.clientId ?? "", clientSecret: "", enabled: c?.enabled ?? true, enforce: c?.enforce ?? false, jitRole: c?.jitRole ?? "viewer" };
  const verified = q.data.domains.some((d) => d.verifiedAt);
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">1. Verify your email domain</h2>
        <p className="text-[13px] text-muted">Add a DNS TXT record to prove the domain is yours. Only people with a verified domain&apos;s email can sign in through SSO, and only one workspace can verify a domain.</p>
        {q.data.domains.map((d) => (
          <div key={d.id} className="space-y-2 rounded-[14px] border border-border p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2"><b className="font-medium">{d.domain}</b>{d.verifiedAt ? <Badge tone="success">Verified</Badge> : <span className="flex gap-2"><Button size="sm" onClick={() => void run(`domains/${d.id}/verify`, "POST", {}, "Domain verified")}>Check now</Button><Button size="sm" variant="ghost" onClick={() => void run(`domains/${d.id}`, "DELETE")}>Remove</Button></span>}</div>
            {!d.verifiedAt && <><p className="text-muted">TXT record name</p><Copyable value={d.record.name} label={`TXT name for ${d.domain}`} /><p className="text-muted">Value</p><Copyable value={d.record.value} label={`TXT value for ${d.domain}`} /></>}
          </div>
        ))}
        <div className="flex gap-2"><Input aria-label="Domain" placeholder="yourcompany.in" value={domain} onChange={(e) => setDomain(e.target.value)} /><Button disabled={!domain.trim()} onClick={async () => { if (await run("domains", "POST", { domain })) setDomain(""); }}>Add domain</Button></div>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">2. Connect your identity provider (OpenID Connect)</h2>
        <p className="text-[13px] text-muted">Create an OIDC web app in Okta, Microsoft Entra ID, Google Workspace, Auth0 or Keycloak with this redirect URI, then enter its issuer, client ID and secret.</p>
        <Copyable value={q.data.redirectUri} label="Redirect URI" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Issuer URL" className="sm:col-span-2">{(a) => <Input {...a} value={v.issuer} onChange={(e) => setF({ ...v, issuer: e.target.value })} placeholder="https://yourcompany.okta.com" />}</Field>
          <Field label="Client ID">{(a) => <Input {...a} value={v.clientId} onChange={(e) => setF({ ...v, clientId: e.target.value })} />}</Field>
          <Field label={c?.hasSecret ? "Client secret (leave blank to keep)" : "Client secret"}>{(a) => <Input {...a} type="password" autoComplete="off" value={v.clientSecret} onChange={(e) => setF({ ...v, clientSecret: e.target.value })} />}</Field>
          <Field label="Role for people signing in for the first time">{(a) => <Select {...a} value={v.jitRole} onChange={(e) => setF({ ...v, jitRole: e.target.value })}>{["viewer", "employee", "editor", "designer", "developer", "billing", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}</Select>}</Field>
          <div className="space-y-2 self-end text-[13px]">
            <label className="flex items-center gap-2"><Switch checked={v.enabled} onChange={(x) => setF({ ...v, enabled: x })} label="SSO on" /> SSO on</label>
            <label className="flex items-center gap-2"><Switch checked={v.enforce} disabled={!verified} onChange={(x) => setF({ ...v, enforce: x })} label="Require SSO for the domain's members" /> Require SSO for the domain&apos;s members</label>
          </div>
        </div>
        {v.enforce && <Notice tone="warning">With SSO required, members with your domain&apos;s email can&apos;t sign in with a password or GitHub. Keep at least one owner on another domain in case your identity provider is down.</Notice>}
        <div className="flex gap-2">
          <Button variant="primary" disabled={!v.issuer || !v.clientId} onClick={async () => { if (await run("sso", "PUT", { ...v, clientSecret: v.clientSecret || undefined }, "Single sign-on saved")) setF(null); }}>Save</Button>
          {c && <Button variant="ghost" onClick={() => setRemove(true)}>Remove SSO</Button>}
        </div>
        {c?.lastLoginAt && <p className="text-[12.5px] text-muted">Last SSO sign-in {dateTime(c.lastLoginAt)}.</p>}
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">3. Provision people with SCIM (optional)</h2>
        <p className="text-[13px] text-muted">Your identity provider can add people, update their names, and remove them from this workspace when they leave. SCIM base URL:</p>
        <Copyable value={q.data.scim.baseUrl} label="SCIM base URL" />
        {scimToken ? <><Notice tone="warning">Copy this token now — it won&apos;t be shown again.</Notice><Copyable value={scimToken} label="SCIM token" /></> : q.data.scim.token ? <p className="text-[13px]">Token <code>{q.data.scim.token.prefix}…</code> made {dateTime(q.data.scim.token.createdAt)}{q.data.scim.token.lastUsedAt ? `, last used ${dateTime(q.data.scim.token.lastUsedAt)}` : ", not used yet"}.</p> : <p className="text-[13px] text-muted">No token yet.</p>}
        <div className="flex gap-2"><Button onClick={async () => { const r = await run("scim", "POST", {}, "New SCIM token made"); if (r) setScimToken(r.token as string); }}>{q.data.scim.token ? "Replace the token" : "Make a token"}</Button>{q.data.scim.token && <Button variant="ghost" onClick={() => void run("scim", "DELETE", undefined, "SCIM switched off")}>Switch SCIM off</Button>}</div>
      </Card>
      <ConfirmDialog open={remove} onClose={() => setRemove(false)} onConfirm={async () => { await run("sso", "DELETE", undefined, "Single sign-on removed"); setRemove(false); }} destructive title="Remove single sign-on?" description="People who only sign in through SSO will need a password reset to get back in." confirmLabel="Remove" />
    </div>
  );
}

function LoginsTab({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["identity", orgId, "logins"], queryFn: () => api<Logins>(`/api/v1/orgs/${orgId}/identity/logins`) });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-3">
      {q.data.attention.map((a) => <Notice key={a.email} tone="warning" title={`${a.failures} failed sign-ins for ${a.email} this week`}>If that wasn&apos;t them, ask them to change their password and turn on two-factor sign-in.</Notice>)}
      {!q.data.events.length ? <Card className="p-6 text-center text-[13px] text-muted">No sign-ins in the last 7 days.</Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">When</th><th className="px-4 py-2.5 font-medium">Who</th><th className="px-4 py-2.5 font-medium">How</th><th className="px-4 py-2.5 font-medium">From</th><th className="px-4 py-2.5 font-medium">Result</th></tr></thead>
            <tbody className="divide-y divide-border">{q.data.events.map((e, i) => <tr key={i}><td className="px-4 py-2.5 whitespace-nowrap text-muted">{dateTime(e.at)}</td><td className="px-4 py-2.5">{e.name}<span className="block text-[12px] text-muted">{e.email}</span></td><td className="px-4 py-2.5">{e.method}</td><td className="px-4 py-2.5">{e.ip ?? "—"}{e.newDevice && <Badge tone="warning" className="ml-1.5">New device</Badge>}</td><td className="px-4 py-2.5"><Badge tone={e.ok ? "success" : "danger"}>{e.ok ? "Signed in" : `Failed${e.reason ? `: ${e.reason}` : ""}`}</Badge></td></tr>)}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
