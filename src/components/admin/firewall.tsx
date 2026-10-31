"use client";

// Security → Firewall: the app's own firewall in front of every request — its
// mode, rule groups, visitor-address source, limits, allow/block lists,
// countries, custom rules, bans, and the log of every refused request. Saving
// the policy asks for the password again (the server requires it).
import { ArrowDown, ArrowUp, Ban, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { RULE_GROUPS, type CustomRule, type RuleGroup } from "@/lib/security/waf";
import { num, Section, Stat, useAdmin, useRun } from "./common";

type Policy = {
  mode: "off" | "monitor" | "block";
  trustProxy: "xff-first" | "xff-last" | "x-real-ip" | "cloudflare";
  rules: Record<RuleGroup, boolean>;
  allowIps: string[];
  blockIps: string[];
  blockCountries: string[];
  ratePerMinute: number;
  autoBanAfter: number;
  autoBanMinutes: number;
  requireCloudflare: boolean;
  custom: CustomRule[];
};
type BanRow = { ip: string; reason: string; source: string; until: string | null; createdAt: string; cloudflareRuleId: string | null };
type Overview = {
  policy: Policy;
  disabledByEnv: boolean;
  originSecretSet: boolean;
  originLastSeen: string | null;
  day: { blocked: number; logged: number };
  week: number;
  byGroup: { grp: string; action: string; n: number }[];
  byRule: { rule: string; n: number }[];
  topIps: { ip: string | null; country: string | null; n: number }[];
  topPaths: { path: string; n: number }[];
  timeline: { hour: string; action: string; n: number }[];
  bans: BanRow[];
};
type Event = { id: number; at: string; ip: string | null; country: string | null; method: string; host: string; path: string; rule: string; grp: string; action: string; detail: string; ua: string };

const TRUST: { id: Policy["trustProxy"]; label: string; line: string }[] = [
  { id: "xff-first", label: "First X-Forwarded-For address", line: "Only right when nothing sits in front of the app — a visitor can set this header themselves." },
  { id: "xff-last", label: "Last X-Forwarded-For address", line: "Behind your own load balancer or reverse proxy that appends the visitor's address." },
  { id: "x-real-ip", label: "X-Real-IP", line: "Behind nginx or a proxy that sets X-Real-IP." },
  { id: "cloudflare", label: "Cloudflare (CF-Connecting-IP)", line: "Behind Cloudflare. Also enables blocking by country." },
];
const FIELDS: CustomRule["field"][] = ["path", "query", "ua", "ip", "country", "method", "host", "referer"];
const OPS: CustomRule["op"][] = ["contains", "equals", "starts", "regex", "in"];
const FIELD_LABEL: Record<CustomRule["field"], string> = { path: "Path", query: "Query string", ua: "User agent", ip: "IP address", country: "Country", method: "Method", host: "Host", referer: "Referer" };
const OP_LABEL: Record<CustomRule["op"], string> = { contains: "contains", equals: "equals", starts: "starts with", regex: "matches regex", in: "is one of" };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ipRe = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;
const lines = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

export function FirewallPanel() {
  const q = useAdmin<Overview>("security/firewall", { refetchInterval: 30_000 });
  const [ipFilter, setIpFilter] = useState("");
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-8">
      {d.disabledByEnv && <Notice tone="danger" title="Switched off by the server environment">FIREWALL=off is set, so nothing is checked. Remove it once you can sign in again.</Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Blocked (24 h)" value={num(d.day.blocked)} tone={d.day.blocked ? "warning" : undefined} />
        <Stat label="Logged only (24 h)" value={num(d.day.logged)} sub="Monitor mode and log rules" />
        <Stat label="Events (7 days)" value={num(d.week)} />
        <Stat label="Banned addresses" value={num(d.bans.length)} />
      </div>
      <Timeline rows={d.timeline} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Top title="Top rules (24 h)" rows={d.byRule.map((r) => ({ k: r.rule, n: r.n }))} />
        <Top title="Top addresses (24 h)" rows={d.topIps.map((r) => ({ k: `${r.ip ?? "unknown"}${r.country ? ` · ${r.country}` : ""}`, n: r.n, ip: r.ip }))} onPick={(ip) => setIpFilter(ip)} />
        <Top title="Top paths (24 h)" rows={d.topPaths.map((r) => ({ k: r.path, n: r.n }))} />
      </div>
      <PolicyEditor key={JSON.stringify(d.policy)} policy={d.policy} originLastSeen={d.originLastSeen} originSecretSet={d.originSecretSet} />
      <Bans bans={d.bans} />
      <EventsLog ip={ipFilter} setIp={setIpFilter} />
    </div>
  );
}

function Timeline({ rows }: { rows: Overview["timeline"] }) {
  const hours = useMemo(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return Array.from({ length: 24 }, (_, i) => new Date(now.getTime() - (23 - i) * 3_600_000));
  }, []);
  const at = (h: Date, a: string) => rows.filter((r) => new Date(r.hour).getTime() === h.getTime() && r.action === a).reduce((s, r) => s + r.n, 0);
  const max = Math.max(1, ...hours.map((h) => at(h, "block") + at(h, "log")));
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">Refused and logged requests, last 24 hours</h3>
        <div className="flex gap-3 text-[12px] text-muted"><span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-danger" /> Blocked</span><span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-warning" /> Logged</span></div>
      </div>
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Requests per hour">
        {hours.map((h) => {
          const b = at(h, "block");
          const l = at(h, "log");
          return (
            <div key={h.toISOString()} className="flex h-full flex-1 flex-col justify-end gap-[2px]" title={`${h.getHours()}:00 — ${b} blocked, ${l} logged`}>
              {l > 0 && <div className="rounded-t-[3px] bg-warning" style={{ height: `${(l / max) * 100}%` }} />}
              {b > 0 && <div className={cx("bg-danger", l ? "" : "rounded-t-[3px]")} style={{ height: `${(b / max) * 100}%` }} />}
              {!b && !l && <div className="h-[2px] rounded bg-surface-3" />}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{hours[0]!.getHours()}:00</span><span>now</span></div>
    </Card>
  );
}

function Top({ title, rows, onPick }: { title: string; rows: { k: string; n: number; ip?: string | null }[]; onPick?: (ip: string) => void }) {
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-[14px] font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-[13px] text-muted">Nothing yet.</p> : (
        <ul className="space-y-1 text-[13px]">
          {rows.map((r) => (
            <li key={r.k} className="flex items-center justify-between gap-2">
              {r.ip && onPick ? <button type="button" className="truncate text-left font-mono text-[12.5px] hover:underline" onClick={() => onPick(r.ip!)}>{r.k}</button> : <span className="truncate font-mono text-[12.5px]">{r.k}</span>}
              <span className="shrink-0 tabular-nums text-muted">{num(r.n)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PolicyEditor({ policy, originLastSeen, originSecretSet }: { policy: Policy; originLastSeen: string | null; originSecretSet: boolean }) {
  const run = useRun();
  const [p, setP] = useState<Policy>(policy);
  const [allow, setAllow] = useState(policy.allowIps.join("\n"));
  const [block, setBlock] = useState(policy.blockIps.join("\n"));
  const [countries, setCountries] = useState(policy.blockCountries.join(", "));
  const [edit, setEdit] = useState<CustomRule | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setP((x) => ({ ...x, [k]: v }));
  const badIps = [...lines(allow), ...lines(block)].filter((x) => !ipRe.test(x));
  const badCountries = lines(countries).filter((x) => !/^[A-Za-z]{2}$/.test(x));
  const next: Policy = { ...p, allowIps: lines(allow), blockIps: lines(block), blockCountries: lines(countries).map((c) => c.toUpperCase()) };
  const changed = JSON.stringify(next) !== JSON.stringify(policy);
  const save = async () => {
    setBusy(true);
    await run("security/firewall", "PUT", next, "Firewall saved");
    setBusy(false);
  };
  const move = (i: number, by: number) => setP((x) => {
    const c = [...x.custom];
    const [r] = c.splice(i, 1);
    c.splice(Math.max(0, Math.min(c.length, i + by)), 0, r!);
    return { ...x, custom: c };
  });
  return (
    <Section title="Policy" sub="What the firewall checks and what it does about it. Saving asks for your password." actions={<Button variant="primary" loading={busy} disabled={!changed || badIps.length > 0 || badCountries.length > 0} onClick={() => void save()}>Save changes</Button>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <h3 className="text-[14px] font-semibold">Mode</h3>
          <div role="radiogroup" aria-label="Firewall mode" className="inline-flex rounded-full bg-surface-2 p-1">
            {(["off", "monitor", "block"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={p.mode === m} onClick={() => set("mode", m)} className={cx("h-8 rounded-full px-4 text-[13px] font-medium capitalize transition-colors", p.mode === m ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>{m}</button>
            ))}
          </div>
          <p className="text-[13px] text-muted">{p.mode === "block" ? "Attacks are refused (403) and repeat offenders banned." : p.mode === "monitor" ? "Nothing is refused — matches are only logged. Use it to check a change before blocking." : "Nothing is checked. Not recommended."}</p>
          <Field label="Where the visitor's address comes from">{(a) => (
            <Select {...a} value={p.trustProxy} onChange={(e) => set("trustProxy", e.target.value as Policy["trustProxy"])}>
              {TRUST.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          )}</Field>
          <p className="text-[12.5px] text-muted">{TRUST.find((t) => t.id === p.trustProxy)?.line}</p>
        </Card>
        <Card className="space-y-3 p-4">
          <h3 className="text-[14px] font-semibold">Limits and bans</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Requests a minute per address" hint="0 = no limit">{(a) => <Input {...a} type="number" min={0} max={100000} value={p.ratePerMinute} onChange={(e) => set("ratePerMinute", Math.max(0, Number(e.target.value) || 0))} />}</Field>
            <Field label="Ban after refused requests" hint="in 10 minutes; 0 = never">{(a) => <Input {...a} type="number" min={0} max={10000} value={p.autoBanAfter} onChange={(e) => set("autoBanAfter", Math.max(0, Number(e.target.value) || 0))} />}</Field>
            <Field label="Ban for (minutes)">{(a) => <Input {...a} type="number" min={1} max={43200} value={p.autoBanMinutes} onChange={(e) => set("autoBanMinutes", Math.max(1, Number(e.target.value) || 1))} />}</Field>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-[12px] bg-surface-2 p-3">
            <div className="text-[13px]">
              <p className="font-medium">Only accept requests through Cloudflare</p>
              <p className="text-muted">{!originSecretSet ? "Lock the origin in Security → Cloudflare first." : originLastSeen ? `Cloudflare's header last seen ${when(originLastSeen)}.` : "Cloudflare's header hasn't been seen on this server yet — don't switch this on until it has."}</p>
            </div>
            <Switch label="Require Cloudflare" checked={p.requireCloudflare} disabled={!originSecretSet || (!originLastSeen && !p.requireCloudflare)} onChange={(v) => set("requireCloudflare", v)} />
          </div>
          {p.requireCloudflare && <Notice tone="warning">Anything not coming through Cloudflare will be refused. If Cloudflare is removed from in front of the app, set FIREWALL=off in the server environment to get back in.</Notice>}
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <h3 className="mb-3 text-[14px] font-semibold">Built-in rules</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {RULE_GROUPS.map((g) => (
            <div key={g.id} className="flex items-start justify-between gap-3 rounded-[12px] bg-surface-2 p-3">
              <div className="text-[13px]"><p className="font-medium">{g.name}</p><p className="text-muted">{g.line}</p></div>
              <Switch label={g.name} checked={p.rules[g.id]} onChange={(v) => set("rules", { ...p.rules, [g.id]: v })} />
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <Field label="Always allow (skip every rule)" hint="One address or IPv4 range per line, e.g. 203.0.113.0/24" error={lines(allow).some((x) => !ipRe.test(x)) ? "Check the addresses" : undefined}>{(a) => <Textarea {...a} rows={5} className="font-mono text-[12.5px]" value={allow} onChange={(e) => setAllow(e.target.value)} />}</Field>
        </Card>
        <Card className="p-4">
          <Field label="Always block" hint="One address or IPv4 range per line" error={lines(block).some((x) => !ipRe.test(x)) ? "Check the addresses" : undefined}>{(a) => <Textarea {...a} rows={5} className="font-mono text-[12.5px]" value={block} onChange={(e) => setBlock(e.target.value)} />}</Field>
        </Card>
        <Card className="p-4">
          <Field label="Block countries" hint={p.trustProxy === "cloudflare" ? "Two-letter codes, e.g. KP, IR" : "Needs Cloudflare as the address source to work"} error={badCountries.length ? `Not a country code: ${badCountries[0]}` : undefined}>{(a) => <Textarea {...a} rows={5} className="font-mono text-[12.5px] uppercase" value={countries} onChange={(e) => setCountries(e.target.value)} />}</Field>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div><h3 className="text-[14px] font-semibold">Custom rules</h3><p className="text-[12.5px] text-muted">Checked in order, before the built-in rules. The first that matches decides.</p></div>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ id: `rule-${Date.now().toString(36)}`, name: "", enabled: true, action: "block", field: "path", op: "starts", value: "" })}>Add rule</Button>
        </div>
        {p.custom.length === 0 ? <p className="text-[13px] text-muted">No custom rules.</p> : (
          <ul className="divide-y divide-border">
            {p.custom.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
                <Switch label={`Enable ${r.name}`} checked={r.enabled} onChange={(v) => set("custom", p.custom.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.name}</p>
                  <p className="truncate text-muted">{FIELD_LABEL[r.field]} {OP_LABEL[r.op]} <code className="font-mono">{r.value}</code></p>
                </div>
                <Badge tone={r.action === "block" ? "danger" : r.action === "allow" ? "success" : "neutral"}>{r.action}</Badge>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === p.custom.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>
                  <Button size="sm" variant="ghost" aria-label="Delete rule" onClick={() => set("custom", p.custom.filter((x) => x.id !== r.id))}><Trash2 className="size-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {changed && <p className="mt-3 text-[13px] text-warning">You have unsaved changes.</p>}
      {edit && <RuleDialog rule={edit} onClose={() => setEdit(null)} onSave={(r) => { set("custom", p.custom.some((x) => x.id === r.id) ? p.custom.map((x) => (x.id === r.id ? r : x)) : [...p.custom, r]); setEdit(null); }} />}
    </Section>
  );
}

function RuleDialog({ rule, onClose, onSave }: { rule: CustomRule; onClose: () => void; onSave: (r: CustomRule) => void }) {
  const [r, setR] = useState(rule);
  let regexError = "";
  if (r.op === "regex") {
    try {
      new RegExp(r.value);
    } catch {
      regexError = "Not a valid regular expression";
    }
  }
  const ok = r.name.trim() && r.value.trim() && !regexError;
  return (
    <Dialog open onClose={onClose} title={rule.name ? "Edit rule" : "Add a rule"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onSave({ ...r, name: r.name.trim() })}>Keep rule</Button></>}>
      <div className="grid gap-3">
        <Field label="Name">{(a) => <Input {...a} autoFocus value={r.name} maxLength={80} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="Admin pages only from the office" />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="When">{(a) => <Select {...a} value={r.field} onChange={(e) => setR({ ...r, field: e.target.value as CustomRule["field"] })}>{FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}</Select>}</Field>
          <Field label="Test">{(a) => <Select {...a} value={r.op} onChange={(e) => setR({ ...r, op: e.target.value as CustomRule["op"] })}>{OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</Select>}</Field>
          <Field label="Then">{(a) => <Select {...a} value={r.action} onChange={(e) => setR({ ...r, action: e.target.value as CustomRule["action"] })}><option value="block">Block</option><option value="allow">Allow (skip other rules)</option><option value="log">Log only</option></Select>}</Field>
        </div>
        <Field label="Value" hint={r.op === "in" ? "Separate values with commas or spaces (IP ranges work for IP address)" : r.op === "regex" ? "Case-insensitive; nested repeats like (a+)+ are refused" : undefined} error={regexError || undefined}>{(a) => <Input {...a} className="font-mono" value={r.value} maxLength={500} onChange={(e) => setR({ ...r, value: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function Bans({ bans }: { bans: BanRow[] }) {
  const run = useRun();
  const [open, setOpen] = useState(false);
  return (
    <Section title="Banned addresses" sub="Refused outright until the time shown. Automatic bans come from repeated attacks." actions={<Button icon={<Ban className="size-4" />} onClick={() => setOpen(true)}>Ban an address</Button>}>
      {bans.length === 0 ? <Card className="p-4 text-[13px] text-muted">No addresses are banned.</Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted"><th className="px-4 py-2 font-medium">Address</th><th className="px-4 py-2 font-medium">Reason</th><th className="px-4 py-2 font-medium">Until</th><th className="px-4 py-2" /></tr></thead>
            <tbody>
              {bans.map((b) => (
                <tr key={b.ip} className="border-t border-border">
                  <td className="px-4 py-2 font-mono">{b.ip} <Badge tone={b.source === "auto" ? "warning" : "neutral"}>{b.source}</Badge>{b.cloudflareRuleId && <Badge className="ml-1">also at Cloudflare</Badge>}</td>
                  <td className="px-4 py-2 text-muted">{b.reason}</td>
                  <td className="px-4 py-2">{b.until ? when(b.until) : "Until removed"}</td>
                  <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => void run(`security/bans?ip=${encodeURIComponent(b.ip)}`, "DELETE", undefined, `${b.ip} unbanned`)}>Unban</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {open && <BanDialog onClose={() => setOpen(false)} />}
    </Section>
  );
}

function BanDialog({ onClose, ip: initial = "" }: { onClose: () => void; ip?: string }) {
  const run = useRun();
  const [ip, setIp] = useState(initial);
  const [minutes, setMinutes] = useState<number | null>(60 * 24);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await run("security/bans", "POST", { ip: ip.trim(), minutes, reason: reason.trim() }, `${ip.trim()} banned`);
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Dialog open onClose={onClose} size="sm" title="Ban an address" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ip.trim() || !reason.trim()} onClick={() => void go()}>Ban</Button></>}>
      <div className="grid gap-3">
        <Field label="IP address">{(a) => <Input {...a} autoFocus className="font-mono" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7" />}</Field>
        <Field label="For">{(a) => (
          <Select {...a} value={minutes === null ? "forever" : String(minutes)} onChange={(e) => setMinutes(e.target.value === "forever" ? null : Number(e.target.value))}>
            <option value="60">1 hour</option><option value="1440">24 hours</option><option value="10080">7 days</option><option value="43200">30 days</option><option value="forever">Until removed</option>
          </Select>
        )}</Field>
        <Field label="Reason">{(a) => <Input {...a} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Password guessing on /login" />}</Field>
      </div>
    </Dialog>
  );
}

function EventsLog({ ip, setIp }: { ip: string; setIp: (v: string) => void }) {
  const [group, setGroup] = useState("");
  const [action, setAction] = useState("");
  // Older pages, kept for the filters they were loaded with.
  const [older, setOlder] = useState<{ key: string; pages: Event[][] }>({ key: "", pages: [] });
  const [open, setOpen] = useState<number | null>(null);
  const [banIp, setBanIp] = useState<string | null>(null);
  const qs = new URLSearchParams({ limit: "50", ...(ip ? { ip } : {}), ...(group ? { group } : {}), ...(action ? { action } : {}) }).toString();
  const q = useAdmin<{ events: Event[] }>(`security/events?${qs}`);
  const pages = older.key === qs ? older.pages : [];
  const setPages = (f: (p: Event[][]) => Event[][]) => setOlder({ key: qs, pages: f(pages) });
  const before = pages.length ? pages[pages.length - 1]!.at(-1)?.id : q.data?.events.at(-1)?.id;
  const more = useAdmin<{ events: Event[] }>(`security/events?${qs}&before=${before ?? 0}`, { enabled: false });
  const rows = [...(q.data?.events ?? []), ...pages.flat()];
  const groups = ["sqli", "xss", "traversal", "probes", "scanners", "protocol", "injection", "ip", "country", "custom", "rate", "ban", "origin"];
  return (
    <Section title="Request log" sub="Every request the firewall refused or logged (kept 30 days). The reference matches the one shown to the visitor." actions={<Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => { setPages(() => []); void q.refetch(); }}>Refresh</Button>}>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" /><Input aria-label="Filter by IP address" className="!w-52 pl-9 font-mono" placeholder="IP address" value={ip} onChange={(e) => setIp(e.target.value.trim())} /></div>
        <Select aria-label="Rule group" className="!w-44" value={group} onChange={(e) => setGroup(e.target.value)}><option value="">Every rule</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</Select>
        <Select aria-label="Action" className="!w-36" value={action} onChange={(e) => setAction(e.target.value)}><option value="">Blocked & logged</option><option value="block">Blocked</option><option value="log">Logged</option></Select>
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : !q.data ? <Skeleton className="h-40" /> : rows.length === 0 ? <Card className="p-4 text-[13px] text-muted">No requests match.</Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted"><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Address</th><th className="px-4 py-2 font-medium">Request</th><th className="px-4 py-2 font-medium">Rule</th><th className="px-4 py-2 font-medium">Action</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const ref = /^\[([0-9a-f]+)\]\s*(.*)$/.exec(e.detail);
                return (
                  <Fragment key={e.id}>
                    <tr className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="px-4 py-2 whitespace-nowrap text-muted">{when(e.at)}</td>
                      <td className="px-4 py-2 font-mono text-[12.5px]">{e.ip ?? "—"}{e.country ? ` · ${e.country}` : ""}</td>
                      <td className="max-w-[320px] truncate px-4 py-2 font-mono text-[12.5px]">{e.method} {e.path}</td>
                      <td className="px-4 py-2">{e.rule}</td>
                      <td className="px-4 py-2"><Badge tone={e.action === "block" ? "danger" : "warning"}>{e.action === "block" ? "Blocked" : "Logged"}</Badge></td>
                    </tr>
                    {open === e.id && (
                      <tr className="bg-surface-2">
                        <td colSpan={5} className="space-y-1 px-4 py-3 text-[12.5px]">
                          {ref && <p><span className="text-muted">Reference </span><code className="font-mono text-[13px] font-semibold">{ref[1]}</code></p>}
                          <p className="break-all"><span className="text-muted">Matched </span>{ref ? ref[2] : e.detail}</p>
                          <p className="break-all font-mono"><span className="font-sans text-muted">URL </span>{e.host}{e.path}</p>
                          <p className="break-all"><span className="text-muted">User agent </span>{e.ua || "—"}</p>
                          {e.ip && <div className="flex gap-2 pt-1"><Button size="sm" onClick={() => setIp(e.ip!)}>Only this address</Button><Button size="sm" icon={<Ban className="size-4" />} onClick={() => setBanIp(e.ip)}>Ban</Button></div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {rows.length >= 50 && <div className="mt-3 text-center"><Button loading={more.isFetching} onClick={async () => { const r = await more.refetch(); if (r.data?.events.length) setPages((p) => [...p, r.data!.events]); }}>Show older</Button></div>}
      {banIp && <BanDialog ip={banIp} onClose={() => setBanIp(null)} />}
    </Section>
  );
}
