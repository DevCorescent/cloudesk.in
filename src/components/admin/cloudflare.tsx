"use client";

// Security → Cloudflare: the edge in front of the app. Connect a scoped API
// token, then: zone status, "I'm under attack", the security settings,
// cache purge, IP access rules, custom WAF rules, Cloudflare's own firewall
// events, copying bans, and locking the origin so only Cloudflare reaches the
// server. Every value shown comes from Cloudflare; changes ask for the password.
import { Cloud, Lock, Plus, RefreshCw, ShieldAlert, Trash2, Unlock } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { num, Section, useAdmin, useRun } from "./common";

type Status =
  | { configured: false; tokenSet: boolean; zoneSet: boolean }
  | {
      configured: true;
      token: { status: string; expires_on?: string };
      zone: { id: string; name: string; status: string; paused: boolean; plan: string; nameServers: string[] };
      settings: Record<string, { value: string; editable: boolean }>;
      originLock: { cloudflareRule: boolean; secretSet: boolean; enforced: boolean; trustProxy: string };
      syncBans: boolean;
    };
type Rules = { access: { id: string; mode: string; notes: string; configuration: { target: string; value: string }; created_on: string }[]; custom: { id: string; description?: string; expression: string; action: string; enabled: boolean }[] };
type Events = { since: string; events: { action: string; clientIP: string; clientCountryName: string; clientRequestPath: string; clientRequestHTTPMethodName: string; datetime: string; source: string; ruleId: string; userAgent: string }[]; byAction: { count: number; dimensions: { action: string; source: string } }[]; byCountry: { count: number; dimensions: { clientCountryName: string } }[] };

// Mirrors CF_SETTINGS in src/server/security/cloudflare.ts (the server checks every value).
const SETTINGS: { id: string; label: string; values: string[] }[] = [
  { id: "ssl", label: "SSL/TLS mode", values: ["off", "flexible", "full", "strict"] },
  { id: "always_use_https", label: "Always use HTTPS", values: ["on", "off"] },
  { id: "automatic_https_rewrites", label: "Automatic HTTPS rewrites", values: ["on", "off"] },
  { id: "min_tls_version", label: "Minimum TLS version", values: ["1.0", "1.1", "1.2", "1.3"] },
  { id: "tls_1_3", label: "TLS 1.3", values: ["on", "off", "zrt"] },
  { id: "security_level", label: "Security level", values: ["essentially_off", "low", "medium", "high", "under_attack"] },
  { id: "browser_check", label: "Browser integrity check", values: ["on", "off"] },
  { id: "challenge_ttl", label: "Challenge passage (seconds)", values: ["300", "900", "1800", "2700", "3600", "7200", "10800", "14400", "28800", "57600", "86400"] },
  { id: "email_obfuscation", label: "Email address obfuscation", values: ["on", "off"] },
  { id: "hotlink_protection", label: "Hotlink protection", values: ["on", "off"] },
  { id: "development_mode", label: "Development mode (bypass cache)", values: ["on", "off"] },
];
const RECOMMENDED: Record<string, string> = { ssl: "strict", always_use_https: "on", min_tls_version: "1.2", tls_1_3: "on", browser_check: "on", automatic_https_rewrites: "on" };
const ACCESS_MODES = ["block", "managed_challenge", "js_challenge", "challenge", "whitelist"];
const TARGETS = ["ip", "ip6", "ip_range", "country", "asn"];
const CUSTOM_ACTIONS = ["block", "managed_challenge", "js_challenge", "challenge", "log", "skip"];
const EXAMPLES = ['(http.request.uri.path contains "/wp-admin")', '(ip.geoip.country in {"KP" "IR"})', '(http.request.uri.path eq "/login" and http.request.method eq "POST" and cf.threat_score gt 10)', '(not cf.client.bot and http.user_agent eq "")'];

export function CloudflarePanel({ onGo }: { onGo?: (tab: string) => void }) {
  const q = useAdmin<Status>("security/cloudflare");
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const s = q.data;
  if (!s) return <Skeleton className="h-96" />;
  if (!s.configured) return <Connect tokenSet={s.tokenSet} zoneSet={s.zoneSet} />;
  return (
    <div className="space-y-8">
      <ZoneHeader s={s} />
      <UnderAttack s={s} />
      <SettingsGrid s={s} />
      <OriginLock s={s} onGo={onGo} />
      <Purge zone={s.zone.name} />
      <RulesSection />
      <EdgeEvents />
      <Disconnect />
    </div>
  );
}

function Connect({ tokenSet, zoneSet }: { tokenSet: boolean; zoneSet: boolean }) {
  const run = useRun();
  const [token, setToken] = useState("");
  const [zone, setZone] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card className="max-w-2xl space-y-4 p-6">
      <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-[12px] bg-[#f6821f]/12 text-[#f6821f]"><Cloud className="size-5" /></span><div><h3 className="text-[16px] font-semibold">Connect Cloudflare</h3><p className="text-[13px] text-muted">DDoS protection, an edge firewall and caching in front of the app — controlled from here.</p></div></div>
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
        <li>Put your domain on Cloudflare (its nameservers) and proxy the app&apos;s DNS record (orange cloud).</li>
        <li>Create an API token (My Profile → API Tokens) for this zone with: Zone Read, Zone Settings Edit, Firewall Services Edit, Zone WAF Edit, Transform Rules Edit, Cache Purge, Analytics Read.</li>
        <li>Copy the Zone ID from the zone&apos;s Overview page.</li>
      </ol>
      {(tokenSet || zoneSet) && <Notice tone="warning">{tokenSet && !zoneSet ? "A token is saved but the zone ID is missing." : !tokenSet ? "A zone ID is saved but the token is missing." : "The saved zone ID doesn't look right."}</Notice>}
      <Field label="API token" hint="Saved encrypted; never shown again.">{(a) => <Input {...a} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value.trim())} />}</Field>
      <Field label="Zone ID">{(a) => <Input {...a} className="font-mono" value={zone} onChange={(e) => setZone(e.target.value.trim())} placeholder="32 hex characters" />}</Field>
      <Button variant="primary" loading={busy} disabled={(!token && !tokenSet) || !/^[a-f0-9]{32}$/.test(zone)} onClick={async () => { setBusy(true); await run("security/cloudflare", "POST", { ...(token ? { token } : {}), zoneId: zone }, "Cloudflare connected"); setBusy(false); }}>Connect</Button>
    </Card>
  );
}

function ZoneHeader({ s }: { s: Extract<Status, { configured: true }> }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <p className="text-[12px] font-semibold tracking-[0.12em] text-muted uppercase">Zone</p>
        <h3 className="mt-0.5 text-[20px] font-semibold">{s.zone.name}</h3>
        <p className="text-[13px] text-muted">{s.zone.plan} · nameservers {s.zone.nameServers.join(", ") || "—"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge tone={s.zone.status === "active" && !s.zone.paused ? "success" : "warning"}>{s.zone.paused ? "Paused" : s.zone.status}</Badge>
        <Badge tone={s.token.status === "active" ? "success" : "danger"}>Token {s.token.status}</Badge>
        {s.originLock.enforced && <Badge tone="success">Origin locked</Badge>}
      </div>
    </Card>
  );
}

function UnderAttack({ s }: { s: Extract<Status, { configured: true }> }) {
  const run = useRun();
  const [ask, setAsk] = useState<"on" | "off" | null>(null);
  const on = s.settings.security_level?.value === "under_attack";
  return (
    <Card className={`flex flex-wrap items-center justify-between gap-4 p-5 ${on ? "ring-2 ring-danger/40" : ""}`}>
      <div className="flex items-start gap-3">
        <ShieldAlert className={`mt-0.5 size-6 ${on ? "text-danger" : "text-muted"}`} />
        <div><h3 className="text-[15px] font-semibold">I&apos;m under attack</h3><p className="max-w-xl text-[13px] text-muted">Every visitor gets a short browser check before reaching the app. Use it during a DDoS or bot flood; switch it off afterwards (it slows everyone&apos;s first visit).</p></div>
      </div>
      <Switch label="I'm under attack mode" checked={on} disabled={!s.settings.security_level?.editable} onChange={(v) => setAsk(v ? "on" : "off")} />
      {ask && (
        <Dialog open onClose={() => setAsk(null)} size="sm" title={ask === "on" ? "Turn on “I'm under attack”?" : "Turn it off?"} description={ask === "on" ? "Visitors will see a check page for a few seconds." : "The security level goes back to Medium."} footer={<><Button onClick={() => setAsk(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await run("security/cloudflare-setting", "PUT", { id: "security_level", value: ask === "on" ? "under_attack" : "medium" }, ask === "on" ? "Under attack mode is on" : "Under attack mode is off"); setAsk(null); }}>{ask === "on" ? "Turn on" : "Turn off"}</Button></>} />
      )}
    </Card>
  );
}

function SettingsGrid({ s }: { s: Extract<Status, { configured: true }> }) {
  const run = useRun();
  return (
    <Section title="Security settings" sub="Live from Cloudflare. Recommended values are marked.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SETTINGS.filter((d) => s.settings[d.id]).map((d) => {
          const cur = s.settings[d.id]!;
          const rec = RECOMMENDED[d.id];
          return (
            <Card key={d.id} className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2"><p className="text-[13.5px] font-medium">{d.label}</p>{rec && cur.value !== rec && <Badge tone="warning">Recommended: {rec}</Badge>}</div>
              <Select aria-label={d.label} disabled={!cur.editable} value={cur.value} onChange={(e) => void run("security/cloudflare-setting", "PUT", { id: d.id, value: e.target.value }, `${d.label}: ${e.target.value}`)}>
                {!d.values.includes(cur.value) && <option value={cur.value}>{cur.value}</option>}
                {d.values.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
              {!cur.editable && <p className="text-[12px] text-muted">Not editable on this plan.</p>}
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

function OriginLock({ s, onGo }: { s: Extract<Status, { configured: true }>; onGo?: (tab: string) => void }) {
  const run = useRun();
  const fw = useAdmin<{ originLastSeen: string | null; policy: Record<string, unknown> }>("security/firewall");
  const [confirm, setConfirm] = useState<"require" | "unlock" | null>(null);
  const [now] = useState(() => Date.now());
  const seen = fw.data?.originLastSeen;
  const recent = !!seen && now - new Date(seen).getTime() < 15 * 60_000;
  const locked = s.originLock.cloudflareRule && s.originLock.secretSet;
  return (
    <Section title="Lock the origin" sub="So nobody can reach the server directly (around Cloudflare's protection) by finding its address.">
      <Card className="space-y-4 p-5">
        <Step n={1} done={locked} title="Cloudflare adds a secret header" line="A transform rule makes Cloudflare send x-cloudesk-origin with a random secret on every request it forwards.">
          {!locked ? <Button icon={<Lock className="size-4" />} onClick={() => void run("security/cloudflare-lock", "POST", undefined, "Origin lock rule created")}>Lock origin</Button> : <Button variant="ghost" icon={<Unlock className="size-4" />} onClick={() => setConfirm("unlock")}>Remove</Button>}
        </Step>
        <Step n={2} done={recent} title="Requests arrive with the header" line={seen ? `Last seen on this server ${new Date(seen).toLocaleString("en-IN")}.` : "Not seen yet — open the site through its Cloudflare address, then refresh."}>
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void fw.refetch()}>Refresh</Button>
        </Step>
        <Step n={3} done={s.originLock.enforced} title="The firewall requires it" line="Requests without the header are refused.">
          {s.originLock.enforced ? <Badge tone="success">Enforced</Badge> : <Button variant="primary" disabled={!locked || !recent} onClick={() => setConfirm("require")}>Require it</Button>}
        </Step>
        {s.originLock.trustProxy !== "cloudflare" && <Notice tone="warning" action={onGo ? <Button size="sm" onClick={() => onGo("firewall")}>Open Firewall</Button> : undefined}>Behind Cloudflare, set the firewall&apos;s visitor-address source to Cloudflare so bans, limits and country rules see real visitors.</Notice>}
        <div className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-2 p-3 text-[13px]">
          <div><p className="font-medium">Copy firewall bans to Cloudflare</p><p className="text-muted">Banned addresses are also blocked at Cloudflare&apos;s edge (as IP access rules).</p></div>
          <Switch label="Copy bans to Cloudflare" checked={s.syncBans} onChange={(v) => void run("security/cloudflare", "POST", { syncBans: v }, v ? "Bans will be copied" : "Bans won't be copied")} />
        </div>
      </Card>
      {confirm === "require" && (
        <Dialog open onClose={() => setConfirm(null)} size="sm" title="Require Cloudflare?" description="Anything not coming through Cloudflare will be refused — including direct visits to the server's address. If Cloudflare is ever removed from in front of the app, set FIREWALL=off in the server environment to get back in." footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await run("security/firewall", "PUT", { ...fw.data!.policy, requireCloudflare: true }, "Only Cloudflare can reach the app now"); setConfirm(null); }}>Require Cloudflare</Button></>} />
      )}
      {confirm === "unlock" && (
        <Dialog open onClose={() => setConfirm(null)} size="sm" title="Remove the origin lock?" description="The firewall stops requiring the header first, then the Cloudflare rule and the secret are removed." footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await run("security/cloudflare-lock", "DELETE", undefined, "Origin lock removed"); setConfirm(null); }}>Remove</Button></>} />
      )}
    </Section>
  );
}

function Step({ n, done, title, line, children }: { n: number; done: boolean; title: string; line: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[12.5px] font-semibold ${done ? "bg-success text-white" : "bg-surface-3 text-muted"}`}>{done ? "✓" : n}</span>
      <div className="min-w-0 flex-1 text-[13px]"><p className="font-medium">{title}</p><p className="text-muted">{line}</p></div>
      {children}
    </div>
  );
}

function Purge({ zone }: { zone: string }) {
  const run = useRun();
  const [files, setFiles] = useState("");
  const [ask, setAsk] = useState(false);
  const list = files.split(/\s+/).filter(Boolean);
  return (
    <Section title="Cache" sub="Clear Cloudflare’s cached copies after a release.">
      <Card className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
        <Field label="Purge these URLs" hint="Full URLs, one per line (up to 30)">{(a) => <Textarea {...a} rows={3} className="font-mono text-[12.5px]" value={files} onChange={(e) => setFiles(e.target.value)} placeholder={`https://${zone}/pricing`} />}</Field>
        <div className="flex flex-col justify-end gap-2">
          <Button disabled={!list.length || list.length > 30} onClick={async () => { await run("security/cloudflare-purge", "POST", { files: list }, `${list.length} URL${list.length === 1 ? "" : "s"} purged`); setFiles(""); }}>Purge URLs</Button>
          <Button variant="ghost" onClick={() => setAsk(true)}>Purge everything</Button>
        </div>
      </Card>
      {ask && <Dialog open onClose={() => setAsk(false)} size="sm" title="Purge everything?" description="Every cached file is dropped; the next visits are slower while the cache refills." footer={<><Button onClick={() => setAsk(false)}>Cancel</Button><Button variant="primary" onClick={async () => { await run("security/cloudflare-purge", "POST", { files: null }, "Cache purged"); setAsk(false); }}>Purge everything</Button></>} />}
    </Section>
  );
}

function RulesSection() {
  const q = useAdmin<Rules>("security/cloudflare-rules");
  const run = useRun();
  const [addAccess, setAddAccess] = useState(false);
  const [addCustom, setAddCustom] = useState(false);
  if (q.isError) return <Section title="Edge rules"><ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /></Section>;
  const r = q.data;
  return (
    <>
      <Section title="IP access rules" sub="Block, challenge or allow addresses, ranges, countries or networks at Cloudflare." actions={<Button icon={<Plus className="size-4" />} onClick={() => setAddAccess(true)}>Add</Button>}>
        {!r ? <Skeleton className="h-24" /> : r.access.length === 0 ? <Card className="p-4 text-[13px] text-muted">No IP access rules.</Card> : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead><tr className="text-left text-[12px] text-muted"><th className="px-4 py-2 font-medium">Applies to</th><th className="px-4 py-2 font-medium">Action</th><th className="px-4 py-2 font-medium">Note</th><th className="px-4 py-2" /></tr></thead>
              <tbody>{r.access.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono">{a.configuration.target}: {a.configuration.value}</td>
                  <td className="px-4 py-2"><Badge tone={a.mode === "whitelist" ? "success" : a.mode === "block" ? "danger" : "warning"}>{a.mode}</Badge></td>
                  <td className="px-4 py-2 text-muted">{a.notes}</td>
                  <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" aria-label="Delete rule" onClick={() => void run(`security/cloudflare-access?id=${a.id}`, "DELETE", undefined, "Rule removed")}><Trash2 className="size-4" /></Button></td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
        )}
      </Section>
      <Section title="Custom WAF rules" sub="Cloudflare's rules language, checked at the edge before requests reach the app." actions={<Button icon={<Plus className="size-4" />} onClick={() => setAddCustom(true)}>Add</Button>}>
        {!r ? <Skeleton className="h-24" /> : r.custom.length === 0 ? <Card className="p-4 text-[13px] text-muted">No custom rules.</Card> : (
          <Card className="divide-y divide-border">{r.custom.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 p-3 text-[13px]">
              <div className="min-w-0 flex-1"><p className="font-medium">{c.description || "Untitled rule"} {!c.enabled && <Badge>off</Badge>}</p><code className="block truncate font-mono text-[12px] text-muted">{c.expression}</code></div>
              <Badge tone={c.action === "block" ? "danger" : "warning"}>{c.action}</Badge>
              <Button size="sm" variant="ghost" aria-label="Delete rule" onClick={() => void run(`security/cloudflare-custom?id=${c.id}`, "DELETE", undefined, "Rule removed")}><Trash2 className="size-4" /></Button>
            </div>
          ))}</Card>
        )}
      </Section>
      {addAccess && <AccessDialog onClose={() => setAddAccess(false)} />}
      {addCustom && <CustomDialog onClose={() => setAddCustom(false)} />}
    </>
  );
}

function AccessDialog({ onClose }: { onClose: () => void }) {
  const run = useRun();
  const [v, setV] = useState({ mode: "block", target: "ip", value: "", notes: "" });
  return (
    <Dialog open onClose={onClose} size="sm" title="Add an IP access rule" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!v.value.trim()} onClick={async () => { if (await run("security/cloudflare-access", "POST", v, "Rule added")) onClose(); }}>Add</Button></>}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Action">{(a) => <Select {...a} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>{ACCESS_MODES.map((m) => <option key={m} value={m}>{m === "whitelist" ? "allow" : m.replace("_", " ")}</option>)}</Select>}</Field>
          <Field label="Applies to">{(a) => <Select {...a} value={v.target} onChange={(e) => setV({ ...v, target: e.target.value })}>{TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}</Select>}</Field>
        </div>
        <Field label="Value" hint="An address, a range (198.51.100.0/24), a country code (KP) or an ASN (AS13335)">{(a) => <Input {...a} autoFocus className="font-mono" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />}</Field>
        <Field label="Note">{(a) => <Input {...a} value={v.notes} maxLength={200} onChange={(e) => setV({ ...v, notes: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function CustomDialog({ onClose }: { onClose: () => void }) {
  const run = useRun();
  const [v, setV] = useState({ description: "", expression: "", action: "managed_challenge" });
  return (
    <Dialog open onClose={onClose} title="Add a custom WAF rule" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!v.description.trim() || !v.expression.trim()} onClick={async () => { if (await run("security/cloudflare-custom", "POST", v, "Rule added")) onClose(); }}>Add</Button></>}>
      <div className="grid gap-3">
        <Field label="Name">{(a) => <Input {...a} autoFocus value={v.description} maxLength={200} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
        <Field label="Expression" hint="Cloudflare checks it when the rule is saved.">{(a) => <Textarea {...a} rows={4} className="font-mono text-[12.5px]" value={v.expression} onChange={(e) => setV({ ...v, expression: e.target.value })} />}</Field>
        <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((x) => <button key={x} type="button" className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11.5px] text-muted hover:text-fg" onClick={() => setV({ ...v, expression: x })}>{x.length > 48 ? `${x.slice(0, 48)}…` : x}</button>)}</div>
        <Field label="Action">{(a) => <Select {...a} value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })}>{CUSTOM_ACTIONS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}</Select>}</Field>
      </div>
    </Dialog>
  );
}

function EdgeEvents() {
  const [hours, setHours] = useState(24);
  const q = useAdmin<Events>(`security/cloudflare-events?hours=${hours}`);
  return (
    <Section title="Cloudflare firewall events" sub="What Cloudflare stopped or challenged before it reached the app." actions={<Select aria-label="Period" className="!w-32" value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value={24}>24 hours</option><option value={72}>72 hours</option></Select>}>
      {q.isError ? <Notice tone="warning">{errorMessage(q.error)}</Notice> : !q.data ? <Skeleton className="h-32" /> : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="space-y-3 p-4 text-[13px]">
            <div><p className="mb-1 font-medium">By action</p>{q.data.byAction.length ? q.data.byAction.map((a) => <p key={`${a.dimensions.action}-${a.dimensions.source}`} className="flex justify-between"><span className="text-muted">{a.dimensions.action} · {a.dimensions.source}</span><span className="tabular-nums">{num(a.count)}</span></p>) : <p className="text-muted">None</p>}</div>
            <div><p className="mb-1 font-medium">By country</p>{q.data.byCountry.length ? q.data.byCountry.map((c) => <p key={c.dimensions.clientCountryName} className="flex justify-between"><span className="text-muted">{c.dimensions.clientCountryName}</span><span className="tabular-nums">{num(c.count)}</span></p>) : <p className="text-muted">None</p>}</div>
          </Card>
          <Card className="overflow-x-auto">
            {q.data.events.length === 0 ? <p className="p-4 text-[13px] text-muted">No events in this period.</p> : (
              <table className="w-full min-w-[640px] text-[13px]">
                <thead><tr className="text-left text-[12px] text-muted"><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Visitor</th><th className="px-4 py-2 font-medium">Request</th><th className="px-4 py-2 font-medium">Action</th></tr></thead>
                <tbody>{q.data.events.map((e, i) => (
                  <tr key={`${e.datetime}-${i}`} className="border-t border-border">
                    <td className="px-4 py-2 whitespace-nowrap text-muted">{new Date(e.datetime).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-2 font-mono text-[12.5px]">{e.clientIP} · {e.clientCountryName}</td>
                    <td className="max-w-[280px] truncate px-4 py-2 font-mono text-[12.5px]">{e.clientRequestHTTPMethodName} {e.clientRequestPath}</td>
                    <td className="px-4 py-2"><Badge tone={e.action === "block" ? "danger" : "warning"}>{e.action}</Badge> <span className="text-[12px] text-muted">{e.source}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </Section>
  );
}

function Disconnect() {
  const run = useRun();
  const [ask, setAsk] = useState(false);
  return (
    <div className="flex justify-end">
      <Button variant="ghost" onClick={() => setAsk(true)}>Disconnect Cloudflare</Button>
      {ask && <Dialog open onClose={() => setAsk(false)} size="sm" title="Disconnect Cloudflare?" description="The token and zone are removed from the console (and the origin lock undone). Cloudflare itself keeps protecting the site with its current settings." footer={<><Button onClick={() => setAsk(false)}>Cancel</Button><Button variant="primary" onClick={async () => { await run("security/cloudflare", "DELETE", undefined, "Cloudflare disconnected"); setAsk(false); }}>Disconnect</Button></>} />}
    </div>
  );
}
