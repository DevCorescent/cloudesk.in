"use client";

// Outreach: Cloudesk's own promotional email. Contacts come from any
// spreadsheet or pasted text; funnels send the template most likely to win
// each person, at the hour they open, within a warming daily limit; opens,
// clicks, unsubscribes and sign-ups are tracked back to the email that won
// them; and the engine pauses anything that starts to hurt deliverability.
import { Activity, ArrowDown, ArrowUp, Brain, Flame, ClipboardPaste, FileSpreadsheet, GitBranch, Hourglass, Mail, MousePointerClick, Pause, Play, Plus, Search, Send, ShieldCheck, Sparkles, Trash2, Upload, X, Zap } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, IconButton, Input, Notice, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { matchColumns, tableFrom, type Target } from "@/lib/import/engine";
import { ACCEPT, readSheets } from "@/lib/store/read-sheet";
import { CATEGORY_LABEL, CONDITION_LABEL, CONDITIONS, CONSENT, CONSENT_LABEL, GOALS, IMPORT_FIELDS, INDUSTRIES, MAILBOX_DAILY_CAP, spamCheck, STAGE_LABEL, STAGES, TEMPLATE_CATEGORIES, type Audience, type Stage, type Step, type TemplateCategory, type TemplateInput } from "@/lib/outreach/model";
import { DailyChart, Section, Stat, num, useAdmin, useCan, useRun } from "./common";

type Rates = { sends: number; opened: number; clicked: number; converted: number; bounced: number; unsubs: number; openRate: number; clickRate: number; conversionRate: number; bounceRate: number; unsubRate: number };
type Overview = {
  settings: { sending: boolean; postalAddress: boolean; sentToday: number; cap: number; left: number };
  funnel: { key: string; label: string; n: number }[];
  stages: { stage: Stage; n: number }[];
  statuses: { status: string; n: number }[];
  last30: Rates;
  daily: { day: string; sent: number; opened: number; clicked: number; converted: number }[];
  industries: { industry: string; sends: number; clicked: number; converted: number; clickRate: number; conversionRate: number }[];
  hours: { hour: number; n: number }[];
  learned: { text: string }[];
  decisions: { id: string; at: string; text: string; level: string }[];
  tracking: { machineOpens: number; machineClicks: number; resends: number; resendOpened: number; replies: number };
  attribution: { exact: number; matched: number; paying: number; mrr: number };
  clients: { client: string; n: number }[];
  links: { url: string; n: number }[];
  hotLeads: { id: string; name: string; email: string; company: string; score: number; why: string; lastEventAt: string | null }[];
};
type Contact = { id: string; verify: string; verifyNote: string; client: string; attribution: string; machineOpens: number; repliedAt: string | null; paidValue: number; email: string; name: string; company: string; title: string; phone: string; city: string; industry: string; tags: string[]; notes: string; data: Record<string, string>; source: string; consent: string; status: string; stage: Stage; score: number; sends: number; opens: number; clicks: number; bestHour: number | null; lastEmailAt: string | null; signedUpAt: string | null; createdAt: string };
type ContactDetail = {
  contact: Contact;
  sends: { id: string; subject: string; status: string; opens: number; clicks: number; openedAt: string | null; clickedAt: string | null; convertedAt: string | null; sentAt: string; funnel: string | null }[];
  events: { id: string; kind: string; detail: Record<string, unknown>; createdAt: string }[];
  enrollments: { id: string; status: string; stepId: string | null; nextAt: string | null; exitReason: string; funnel: string }[];
};
type Arm = { sends: number; opens: number; clicks: number; conversions: number };
type Template = TemplateInput & { id: string; key: string | null; retired: number[]; stats: Arm; variants: (Arm & { subject: string })[]; links: { url: string; clicks: number }[] };
type Funnel = { id: string; key: string | null; name: string; kind: "funnel" | "broadcast"; status: string; audience: Audience; steps: Step[]; goal: (typeof GOALS)[number]; autoEnroll: boolean; autoOptimize: boolean; priority: number; holdoutPct: number; startAt: string | null; pausedReason: string; control: { emailed: number; holdout: number; people: number } | null; revenue: number; enrolled: number; active: number; converted: number; sends: number; opens: number; clicks: number; conversions: number; unsubs: number; bounces: number };
type FunnelDetail = { funnel: Funnel; steps: (Step & Arm & { waiting: number })[]; audienceSize: number };
type Mailbox = { id: string; address: string; name: string; provider: string; status: string };
type Settings = { sending: boolean; fromName: string; via: "platform" | "mailbox"; fromEmail: string; accountId: string | null; replyTo: string; postalAddress: string; dailyLimit: number; warmup: boolean; warmupStart: number; warmupGrowth: number; windowStart: number; windowEnd: number; days: number[]; minGapHours: number; maxPerWeek: number; aiEvolve: boolean; alerts: boolean; alertEmail: string; sunsetAfter: number; maxBounceRate: number; maxUnsubRate: number; startedAt: string | null };
type ImportResult = { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");
const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1).replace(/[-_]/g, " ") : s);
const STAGE_TONE: Record<Stage, "neutral" | "accent" | "warning" | "success" | "danger"> = { new: "neutral", engaged: "accent", hot: "warning", signed_up: "success", trial: "success", paying: "success", lost: "danger" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const newId = () => Math.random().toString(36).slice(2, 8);

type View = "overview" | "contacts" | "funnels" | "templates" | "activity" | "deliverability" | "settings";

type Tick = { sent: number; failed: number; reason?: string; funnels: number; queued: number; nextAt: string | null };
const REASON: Record<string, string> = {
  "sending is off": "Sending is off — switch it on in Settings.",
  "no postal address": "Add your postal address in Settings first.",
  "daily limit reached": "Today's limit is used up; it carries on tomorrow.",
  "no funnel is running": "No funnel is running — start one in Funnels.",
  "nobody is waiting in the running funnels": "Nobody is in the running funnels — import contacts that match their audience.",
};

/** What a run did, in words. */
function tickMessage(r: Tick): { tone: "success" | "error" | "info"; title: string; description?: string } {
  const next = r.nextAt ? `Next email ${when(r.nextAt)}` : undefined;
  if (r.sent) return { tone: "success", title: `Sent ${r.sent} ${r.sent === 1 ? "email" : "emails"}`, description: [r.failed ? `${r.failed} failed` : "", `${num(r.queued)} in ${r.funnels} running ${r.funnels === 1 ? "funnel" : "funnels"}`, next ?? ""].filter(Boolean).join(" · ") };
  if (r.reason?.startsWith("sending failed")) return { tone: "error", title: "Sending failed", description: r.reason.replace(/^sending failed — /, "") };
  if (r.reason === "nobody is due yet") return { tone: "info", title: "Nobody is due right now", description: `${num(r.queued)} waiting — each gets their email at their best hour inside the sending window (Settings → When).${next ? ` ${next}.` : ""}` };
  return { tone: "info", title: "Nothing sent", description: REASON[r.reason ?? ""] ?? r.reason };
}

export function OutreachPanel() {
  const [view, setView] = useState<View>("overview");
  const o = useAdmin<Overview>("outreach/overview", { refetchInterval: 60_000 });
  const run = useRun();
  const can = useCan();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const s = o.data?.settings;
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px]">
          {s ? (
            <>
              <Badge tone={s.sending ? "success" : "neutral"}>{s.sending ? "Sending" : "Sending off"}</Badge>
              <span className="text-muted tabular-nums">{num(s.sentToday)} of {num(s.cap)} sent today</span>
            </>
          ) : <Skeleton className="h-5 w-40" />}
        </div>
        {can("outreach:write") && (
          <Button size="sm" icon={<Zap className="size-3.5" />} loading={running} onClick={async () => {
            setRunning(true);
            const r = await run<Tick>("outreach/run", "POST");
            setRunning(false);
            if (r) toast(tickMessage(r));
          }}>Run now</Button>
        )}
      </div>
      <Tabs<View>
        value={view}
        onChange={setView}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "contacts", label: "Contacts" },
          { value: "funnels", label: "Funnels" },
          { value: "templates", label: "Templates" },
          { value: "activity", label: "Activity" },
          { value: "deliverability", label: "Deliverability" },
          { value: "settings", label: "Settings" },
        ]}
      />
      {view === "overview" && <OverviewView o={o.data} error={o.isError ? errorMessage(o.error) : null} go={setView} />}
      {view === "contacts" && <ContactsView />}
      {view === "funnels" && <FunnelsView />}
      {view === "templates" && <TemplatesView />}
      {view === "activity" && <ActivityView />}
      {view === "deliverability" && <DeliverabilityView />}
      {view === "settings" && <SettingsView />}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function Cell({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return <div className="min-w-0 bg-surface p-3"><p className="truncate text-[11.5px] text-muted">{label}</p><p className="text-[18px] font-semibold tabular-nums">{value}</p>{sub && <p className="truncate text-[11px] text-subtle">{sub}</p>}</div>;
}

function OverviewView({ o, error, go }: { o?: Overview; error: string | null; go: (v: View) => void }) {
  const [lead, setLead] = useState<string | null>(null);
  if (error) return <ErrorState message={error} />;
  if (!o) return <Skeleton className="h-96" />;
  const l = o.last30;
  const top = o.funnel[0]?.n || 1;
  const peak = Math.max(1, ...o.hours.map((h) => h.n));
  return (
    <div className="space-y-6">
      {!o.settings.sending && (
        <Notice tone={o.settings.postalAddress ? "neutral" : "warning"} title={o.settings.postalAddress ? "Sending is off" : "Add a postal address to start"} action={<Button size="sm" onClick={() => go("settings")}>Settings</Button>}>
          {o.settings.postalAddress ? "Funnels wait until sending is switched on in Settings." : "Every promotional email must carry your postal address. Add it in Settings, then switch sending on."}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Sent · 30 days" value={num(l.sends)} sub={`${num(o.settings.left)} left today`} />
        <Stat label="Open rate" value={`${l.openRate}%`} sub={`${num(l.opened)} opened`} />
        <Stat label="Click rate" value={`${l.clickRate}%`} sub={`${num(l.clicked)} clicked`} />
        <Stat label="Sign-ups won" value={num(l.converted)} sub={`${l.conversionRate}% of emails`} tone={l.converted ? "success" : undefined} />
        <Stat label="Bounces" value={`${l.bounceRate}%`} sub={`${num(l.bounced)} bounced`} tone={l.bounceRate > 3 ? "danger" : undefined} />
        <Stat label="Unsubscribes" value={`${l.unsubRate}%`} sub={`${num(l.unsubs)} left`} tone={l.unsubRate > 1 ? "warning" : undefined} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Section title="Conversion funnel" sub="Every contact, all time.">
          <Card className="space-y-2.5 p-4">
            {o.funnel.map((f, i) => (
              <div key={f.key} className="grid grid-cols-[84px_minmax(0,1fr)_auto] items-center gap-3 text-[12.5px]">
                <span className="truncate text-muted">{f.label}</span>
                <span className="h-6 min-w-0 overflow-hidden rounded-[6px] bg-surface-2">
                  <span className="block h-full rounded-[6px] bg-accent/80" style={{ width: `${Math.max(f.n ? 1.5 : 0, (f.n / top) * 100)}%` }} />
                </span>
                <span className="w-24 text-right tabular-nums"><b className="font-semibold">{num(f.n)}</b>{i > 0 && <span className="ml-1.5 text-subtle">{pct(f.n, o.funnel[i - 1]!.n)}</span>}</span>
              </div>
            ))}
          </Card>
        </Section>
        <Section title="What the engine learned" sub="It shifts sends towards what works, on its own.">
          <Card className="divide-y divide-border">
            {o.learned.length ? o.learned.map((x, i) => (
              <p key={i} className="flex gap-2.5 p-3 text-[13px]"><Brain className="mt-0.5 size-4 shrink-0 text-accent" /><span className="min-w-0">{x.text}</span></p>
            )) : <p className="flex gap-2.5 p-4 text-[13px] text-muted"><Sparkles className="mt-0.5 size-4 shrink-0" /><span>It needs about 30 sends of each subject line before it calls a winner. Until then it tries every option fairly.</span></p>}
          </Card>
        </Section>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Section title="Hot leads" sub="Replied or clicked — the engine follows up; a personal word wins most.">
          <Card className="divide-y divide-border">
            {o.hotLeads.length ? o.hotLeads.map((h) => (
              <button key={h.id} type="button" onClick={() => setLead(h.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
                <Flame className={cx("size-4 shrink-0", h.why.startsWith("Replied") ? "text-danger" : "text-warning")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{h.name || h.email}{h.company ? <span className="font-normal text-muted"> · {h.company}</span> : null}</span>
                  <span className="block truncate text-[12px] text-muted">{h.why} · {ago(h.lastEventAt)}</span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold tabular-nums">{h.score}</span>
              </button>
            )) : <p className="p-4 text-[13px] text-muted">Nobody hot yet. Clicks, repeat opens and replies put people here — and into the hot-lead funnel.</p>}
          </Card>
        </Section>
        <Section title="What outreach won" sub="Sign-ups credited to an email, and what they pay.">
          <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border">
            <Cell label="Signed up after clicking" value={num(o.attribution.exact)} sub="Exact: followed the link" />
            <Cell label="Signed up, same address" value={num(o.attribution.matched)} sub="Matched by email" />
            <Cell label="Now paying" value={num(o.attribution.paying)} />
            <Cell label="Monthly revenue won" value={`₹${num(o.attribution.mrr)}`} />
            <Cell label="Replies" value={num(o.tracking.replies)} sub="From a Cloudesk Mail mailbox" />
            <Cell label="Machine hits ignored" value={num(o.tracking.machineOpens + o.tracking.machineClicks)} sub="Privacy proxies, scanners" />
          </Card>
        </Section>
      </div>

      <Section title="Last 30 days" sub="Sent, opened, clicked and sign-ups by day.">
        <Card className="min-w-0 p-3">
          {o.daily.length ? <DailyChart kind="line" series={[{ label: "Sent", points: o.daily.map((d) => ({ day: d.day, n: d.sent })) }, { label: "Opened", points: o.daily.map((d) => ({ day: d.day, n: d.opened })) }, { label: "Clicked", points: o.daily.map((d) => ({ day: d.day, n: d.clicked })) }, { label: "Signed up", points: o.daily.map((d) => ({ day: d.day, n: d.converted })) }]} /> : <p className="p-6 text-center text-[13px] text-muted">Nothing sent in the last 30 days.</p>}
        </Card>
      </Section>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="By industry" sub="Who responds, and who converts.">
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <thead className="text-left text-[11.5px] text-muted"><tr><th className="px-3 py-2 font-medium">Industry</th><th className="px-3 py-2 text-right font-medium">Sent</th><th className="px-3 py-2 text-right font-medium">Click</th><th className="px-3 py-2 text-right font-medium">Sign-up</th></tr></thead>
              <tbody className="divide-y divide-border">
                {o.industries.length ? o.industries.map((x) => (
                  <tr key={x.industry}><td className="px-3 py-2">{cap(x.industry)}</td><td className="px-3 py-2 text-right tabular-nums">{num(x.sends)}</td><td className="px-3 py-2 text-right tabular-nums">{x.clickRate}%</td><td className="px-3 py-2 text-right tabular-nums">{x.conversionRate}%</td></tr>
                )) : <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">No sends yet</td></tr>}
              </tbody>
            </table>
          </Card>
        </Section>
        <Section title="When people open" sub="Opens by hour, India time. Each person is sent at their own best hour once known.">
          <Card className="p-4">
            <div className="flex h-28 items-end gap-[3px]">
              {Array.from({ length: 24 }, (_, h) => {
                const n = o.hours.find((x) => x.hour === h)?.n ?? 0;
                return <span key={h} title={`${String(h).padStart(2, "0")}:00 · ${n} opens`} className={cx("min-w-0 flex-1 rounded-t-[3px]", n === peak && n > 0 ? "bg-accent" : "bg-accent/35")} style={{ height: `${Math.max(3, (n / peak) * 100)}%` }} />;
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[10.5px] text-subtle tabular-nums"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          </Card>
        </Section>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Mail apps" sub="Where people read, from real opens.">
          <Card className="space-y-2 p-4">
            {o.clients.length ? o.clients.map((c) => (
              <div key={c.client} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[12.5px]">
                <span className="min-w-0"><span className="block truncate">{c.client}</span><span className="mt-1 block h-1.5 rounded-full bg-accent/70" style={{ width: `${(c.n / o.clients[0]!.n) * 100}%` }} /></span>
                <span className="tabular-nums text-muted">{num(c.n)}</span>
              </div>
            )) : <p className="text-[13px] text-muted">Shows once people open.</p>}
          </Card>
        </Section>
        <Section title="Most-clicked links" sub="Last 30 days, people only.">
          <Card className="divide-y divide-border">
            {o.links.length ? o.links.map((l) => (
              <div key={l.url} className="flex items-center gap-3 px-3 py-2 text-[12.5px]"><span className="min-w-0 flex-1 truncate">{l.url.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}</span><span className="shrink-0 tabular-nums text-muted">{num(l.n)}</span></div>
            )) : <p className="p-4 text-[13px] text-muted">No clicks yet.</p>}
          </Card>
        </Section>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Section title="Where contacts are" sub="Stages move on their own, from what people do.">
          <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
            {o.stages.map((s) => (
              <div key={s.stage} className="min-w-0 bg-surface p-3"><p className="truncate text-[11.5px] text-muted">{STAGE_LABEL[s.stage]}</p><p className="text-[18px] font-semibold tabular-nums">{num(s.n)}</p></div>
            ))}
            {o.statuses.filter((s) => s.status !== "active").map((s) => (
              <div key={s.status} className="min-w-0 bg-surface p-3"><p className="truncate text-[11.5px] text-muted">{cap(s.status)}</p><p className="text-[18px] font-semibold text-subtle tabular-nums">{num(s.n)}</p></div>
            ))}
          </Card>
        </Section>
        <Section title="Engine decisions" sub="What it did on its own, most recent first.">
          <Card className="max-h-[320px] divide-y divide-border overflow-y-auto">
            {o.decisions.length ? o.decisions.map((d) => (
              <div key={d.id} className="flex gap-2.5 px-3 py-2.5 text-[12.5px]">
                <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", d.level === "warning" ? "bg-warning" : "bg-accent")} />
                <span className="min-w-0 flex-1 break-words">{d.text}</span>
                <span className="shrink-0 text-[11.5px] text-subtle">{ago(d.at)}</span>
              </div>
            )) : <p className="p-4 text-[13px] text-muted">No decisions yet. It pauses risky funnels, stops emailing people who never open, and exits people who convert.</p>}
          </Card>
        </Section>
      </div>
      {lead && <ContactDialog id={lead} onClose={() => setLead(null)} />}
    </div>
  );
}

// ── Contacts ────────────────────────────────────────────────────────────────

function ContactsView() {
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  const [stage, setStage] = useState("");
  const [industry, setIndustry] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [verify, setVerify] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const run = useRun();
  const can = useCan();
  useEffect(() => {
    const t = setTimeout(() => { setDeb(q); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams({ q: deb, stage, industry, source, status, verify, page: String(page) });
  const list = useAdmin<{ contacts: Contact[]; total: number; sources: string[] }>(`outreach/contacts?${qs}`);
  const rows = list.data?.contacts ?? [];
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const filter = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => { set(e.target.value); setPage(0); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email, name or company" className="pl-8" aria-label="Search contacts" />
        </div>
        {can("outreach:write") && (
          <div className="flex gap-2">
            <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => setImporting(true)}>Import</Button>
            <Button size="sm" icon={<ClipboardPaste className="size-3.5" />} onClick={() => setPasting(true)}>Paste</Button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Select value={verify} onChange={filter(setVerify)} aria-label="Address check"><option value="">Any address</option><option value="valid">Checked</option><option value="risky">Shared inbox</option><option value="invalid">Won’t be sent</option><option value="unknown">Not checked yet</option></Select>
        <Select value={stage} onChange={filter(setStage)} aria-label="Stage"><option value="">Every stage</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
        <Select value={industry} onChange={filter(setIndustry)} aria-label="Industry"><option value="">Every industry</option>{INDUSTRIES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select>
        <Select value={source} onChange={filter(setSource)} aria-label="Source"><option value="">Every source</option>{list.data?.sources.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select value={status} onChange={filter(setStatus)} aria-label="Status"><option value="">Any status</option>{["active", "unsubscribed", "bounced", "complained", "suppressed"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select>
      </div>
      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-border bg-surface-2 px-3 py-2 text-[12.5px]">
          <span className="font-medium">{picked.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} className="ml-auto" onClick={async () => { if (await run("outreach/contacts/delete", "POST", { ids: [...picked] }, "Deleted")) setPicked(new Set()); }}>Delete</Button>
        </div>
      )}
      {list.isError ? <ErrorState message={errorMessage(list.error)} /> : !list.data ? <Skeleton className="h-72" /> : !rows.length ? (
        <Card className="p-10 text-center">
          <FileSpreadsheet className="mx-auto size-6 text-subtle" />
          <p className="mt-2 text-[14px] font-medium">No contacts here</p>
          <p className="text-[12.5px] text-muted">Import a spreadsheet (any columns — extras become merge fields) or paste a list of emails.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {rows.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
              {can("outreach:write") && <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.email}`} className="size-4 shrink-0 accent-[var(--accent)]" />}
              <button type="button" onClick={() => setOpen(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{c.name || c.email}</span>
                  <span className="block truncate text-[12px] text-muted">{[c.name ? c.email : "", c.company, cap(c.industry), c.city].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="hidden shrink-0 text-right text-[11.5px] text-muted tabular-nums sm:block">{c.sends} sent · {c.opens} opens · {c.clicks} clicks</span>
                <span className="w-9 shrink-0 text-right text-[12px] font-semibold tabular-nums" title="Engagement score">{c.score}</span>
                {c.status !== "active" ? <Badge tone="danger">{cap(c.status)}</Badge> : c.verify === "invalid" ? <Badge tone="danger">Bad address</Badge> : <Badge tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}</Badge>}
              </button>
            </div>
          ))}
        </Card>
      )}
      {list.data && list.data.total > 100 && (
        <div className="flex items-center justify-between text-[12.5px] text-muted">
          <span className="tabular-nums">{num(page * 100 + 1)}–{num(Math.min(list.data.total, page * 100 + 100))} of {num(list.data.total)}</span>
          <div className="flex gap-2"><Button size="sm" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={(page + 1) * 100 >= list.data.total} onClick={() => setPage(page + 1)}>Next</Button></div>
        </div>
      )}
      {open && <ContactDialog id={open} onClose={() => setOpen(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {pasting && <PasteDialog onClose={() => setPasting(false)} />}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = { open: "Opened", click: "Clicked", unsubscribe: "Unsubscribed", bounce: "Bounced", complaint: "Marked it as spam", signup: "Signed up", trial: "Started a trial", paid: "Started paying", import: "Imported" };

function ContactDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useAdmin<ContactDetail>(`outreach/contacts/${id}`);
  const run = useRun();
  const can = useCan();
  const c = d.data?.contact;
  const timeline = useMemo(() => {
    if (!d.data) return [];
    return [
      ...d.data.sends.map((s) => ({ at: s.sentAt, icon: <Mail className="size-3.5" />, text: <><b className="font-medium">{s.subject}</b>{s.funnel ? <span className="text-muted"> · {s.funnel}</span> : null}{s.status === "bounced" ? <Badge tone="danger" className="ml-1.5">Bounced</Badge> : s.convertedAt ? <Badge tone="success" className="ml-1.5">Won the sign-up</Badge> : null}</> })),
      ...d.data.events.map((e) => ({ at: e.createdAt, icon: e.kind === "click" ? <MousePointerClick className="size-3.5" /> : e.kind === "engine" ? <Brain className="size-3.5" /> : <Activity className="size-3.5" />, text: <>{e.kind === "engine" ? String(e.detail.text ?? "") : EVENT_LABEL[e.kind] ?? cap(e.kind)}{e.kind === "click" && typeof e.detail.url === "string" ? <span className="block truncate text-[11.5px] text-muted">{e.detail.url}</span> : null}</> })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }, [d.data]);
  return (
    <Dialog open onClose={onClose} size="lg" title={c ? c.name || c.email : "Contact"} description={c ? [c.name ? c.email : "", c.company, c.title].filter(Boolean).join(" · ") : undefined}>
      {!d.data || !c ? <Skeleton className="h-60" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Stage" value={c.status === "active" ? STAGE_LABEL[c.stage] : cap(c.status)} />
            <Mini label="Score" value={c.score} />
            <Mini label="Opens / clicks" value={`${c.opens} / ${c.clicks}`} />
            <Mini label="Best hour" value={c.bestHour === null ? "Learning" : `${String(c.bestHour).padStart(2, "0")}:00`} />
          </div>
          <div className="grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-2">
            {[["Address", c.verifyNote || (c.verify === "valid" ? "Mail server checked" : c.verify === "unknown" ? "Not checked yet" : "")], ["Reads on", c.client], ["Signed up", c.attribution ? `${c.attribution === "exact" ? "Clicked an email, then signed up" : "Same address as a sign-up"}` : ""], ["Pays", c.paidValue ? `₹${num(c.paidValue)}/month` : ""], ["Replied", c.repliedAt ? when(c.repliedAt) : ""], ["Industry", cap(c.industry)], ["City", c.city], ["Phone", c.phone], ["Source", c.source], ["Consent", CONSENT_LABEL[c.consent as keyof typeof CONSENT_LABEL] ?? c.consent], ["Tags", c.tags.join(", ")], ...Object.entries(c.data ?? {}).map(([k, v]) => [`{{${k}}}`, v])].filter(([, v]) => v).map(([k, v]) => (
              <p key={k} className="flex min-w-0 gap-2"><span className="w-24 shrink-0 truncate text-muted">{k}</span><span className="min-w-0 break-words">{v}</span></p>
            ))}
          </div>
          {d.data.enrollments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.data.enrollments.map((e) => <Badge key={e.id} tone={e.status === "active" ? "accent" : e.status === "converted" ? "success" : "neutral"}>{e.funnel}: {e.status === "active" ? `next ${when(e.nextAt)}` : e.exitReason ? cap(e.exitReason) : cap(e.status)}</Badge>)}
            </div>
          )}
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted">Timeline</p>
            {timeline.length ? (
              <ol className="max-h-72 space-y-2.5 overflow-y-auto">
                {timeline.map((t, i) => (
                  <li key={i} className="flex gap-2.5 text-[12.5px]"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">{t.icon}</span><span className="min-w-0 flex-1 break-words">{t.text}</span><span className="shrink-0 text-[11.5px] text-subtle">{when(t.at)}</span></li>
                ))}
              </ol>
            ) : <p className="text-[12.5px] text-muted">Nothing sent yet.</p>}
          </div>
          {can("outreach:write") && c.status === "active" && (
            <div className="flex justify-end"><Button size="sm" variant="danger" onClick={async () => { if (await run(`outreach/contacts/${c.id}`, "PATCH", { status: "suppressed" }, "They won't be emailed again")) onClose(); }}>Never email</Button></div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Mini({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-0 rounded-[12px] bg-surface-2 p-2.5"><p className="truncate text-[11px] text-muted">{label}</p><p className="truncate text-[14px] font-semibold tabular-nums">{value}</p></div>;
}

const TARGET: Target = { id: "outreach", label: "Contacts", noun: "contact", fields: IMPORT_FIELDS };
const slug = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "column";

function SourceFields({ source, setSource, consent, setConsent, tags, setTags }: { source: string; setSource: (v: string) => void; consent: string; setConsent: (v: string) => void; tags: string; setTags: (v: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Source" hint="Where this list came from.">{(a) => <Input {...a} value={source} onChange={(e) => setSource(e.target.value)} maxLength={120} />}</Field>
      <Field label="Why you may email them">{(a) => <Select {...a} value={consent} onChange={(e) => setConsent(e.target.value)}>{CONSENT.map((c) => <option key={c} value={c}>{CONSENT_LABEL[c]}</option>)}</Select>}</Field>
      <Field label="Tags" hint="Comma separated.">{(a) => <Input {...a} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="trade-fair, pune" />}</Field>
    </div>
  );
}
const tagList = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);

function ImportDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const run = useRun();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState("");
  const [table, setTable] = useState<{ headers: string[]; rows: unknown[][] } | null>(null);
  const [map, setMap] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [consent, setConsent] = useState<string>("legitimate_interest");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const load = async (f: File) => {
    try {
      const sheets = (await readSheets(await f.arrayBuffer(), f.name)).filter((s) => s.grid.length > 1);
      if (!sheets.length) throw new Error("We couldn't find any rows in that file.");
      const best = sheets.map((s) => tableFrom(s.grid, TARGET)).sort((a, b) => matchColumns(b.headers, b.rows, TARGET).filter((m) => m.field).length - matchColumns(a.headers, a.rows, TARGET).filter((m) => m.field).length || b.rows.length - a.rows.length)[0]!;
      const m = matchColumns(best.headers, best.rows, TARGET);
      setTable(best);
      // Matched columns fill their field; everything else is kept as a merge field.
      setMap(best.headers.map((h, i) => m[i]?.field ?? `data:${slug(h)}`));
      setFile(f.name);
      setSource(f.name.replace(/\.[^.]+$/, "").slice(0, 120));
    } catch (e) {
      toast({ tone: "error", title: e instanceof Error ? e.message : "That file couldn't be read" });
    }
  };
  const emailCol = map.indexOf("email");
  const go = async () => {
    if (!table) return;
    setBusy(true);
    const total: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    const rows = table.rows.map((r) => {
      const o: Record<string, unknown> = {};
      map.forEach((m, i) => {
        const v = r[i];
        if (!m || v === null || v === undefined || String(v).trim() === "") return;
        o[m.startsWith("data:") ? m.slice(5) : m] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
      });
      return o;
    });
    for (let i = 0; i < rows.length; i += 5000) {
      const r = await run<ImportResult>("outreach/contacts/import", "POST", { rows: rows.slice(i, i + 5000), source: source || "Import", consent, tags: tagList(tags) });
      if (!r) break;
      total.created += r.created;
      total.updated += r.updated;
      total.skipped += r.skipped;
      total.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })));
      setProgress(Math.min(rows.length, i + 5000) / rows.length);
    }
    setBusy(false);
    setResult(total);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Import contacts"
      description="Excel, CSV, Numbers or ODS. Columns are matched for you; anything else is kept and becomes a merge field."
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!table || emailCol < 0} onClick={() => void go()}>{busy ? `Importing ${Math.round(progress * 100)}%` : `Import ${table ? num(table.rows.length) : ""} rows`}</Button></>}
    >
      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2"><Mini label="Added" value={num(result.created)} /><Mini label="Updated" value={num(result.updated)} /><Mini label="Skipped" value={num(result.skipped)} /></div>
          {result.errors.length > 0 && <Card className="max-h-48 divide-y divide-border overflow-y-auto text-[12.5px]">{result.errors.slice(0, 50).map((e, i) => <p key={i} className="px-3 py-1.5"><span className="text-muted tabular-nums">Row {e.row}</span> · {e.message}</p>)}</Card>}
          <p className="text-[12.5px] text-muted">New contacts that match a running funnel’s audience join it on the next run.</p>
        </div>
      ) : !table ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void load(f); }}
          className="flex w-full flex-col items-center gap-2 rounded-[16px] border border-dashed border-border-strong px-4 py-12 text-center hover:bg-surface-2"
        >
          <FileSpreadsheet className="size-7 text-subtle" />
          <span className="text-[14px] font-medium">Choose a file or drop it here</span>
          <span className="text-[12px] text-muted">Needs an email column. Names, companies, cities, industries and any other columns are welcome.</span>
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }} />
        </button>
      ) : (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-2 text-[12.5px]"><FileSpreadsheet className="size-4 text-muted" /><b className="font-medium">{file}</b><span className="text-muted">{num(table.rows.length)} rows · {table.headers.length} columns</span><Button size="sm" variant="ghost" onClick={() => setTable(null)}>Change</Button></p>
          {emailCol < 0 && <Notice tone="warning">Pick which column holds the email addresses.</Notice>}
          <Card className="divide-y divide-border">
            {table.headers.map((h, i) => (
              <div key={i} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{h}</p>
                  <p className="truncate text-[11.5px] text-muted">{table.rows.slice(0, 3).map((r) => String(r[i] ?? "")).filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <Select value={map[i] ?? ""} onChange={(e) => setMap((m) => m.map((x, j) => (j === i ? e.target.value : x === e.target.value && !x.startsWith("data:") && x ? `data:${slug(table.headers[j]!)}` : x)))} aria-label={`Use “${h}” as`}>
                  {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  <option value={`data:${slug(h)}`}>Keep as {`{{${slug(h)}}}`}</option>
                  <option value="">Leave out</option>
                </Select>
              </div>
            ))}
          </Card>
          <SourceFields source={source} setSource={setSource} consent={consent} setConsent={setConsent} tags={tags} setTags={setTags} />
        </div>
      )}
    </Dialog>
  );
}

function PasteDialog({ onClose }: { onClose: () => void }) {
  const run = useRun();
  const [text, setText] = useState("");
  const [source, setSource] = useState("Pasted");
  const [consent, setConsent] = useState<string>("legitimate_interest");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const found = useMemo(() => new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.map((x) => x.toLowerCase())).size, [text]);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Paste contacts"
      description="Anything with email addresses in it: a column copied from a sheet, an email signature, “Name <email>, Company” lines."
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!found} onClick={async () => { setBusy(true); const r = await run<ImportResult>("outreach/contacts/paste", "POST", { text, source: source || "Pasted", consent, tags: tagList(tags) }); setBusy(false); if (r) setResult(r); }}>Add {found || ""} {found === 1 ? "contact" : "contacts"}</Button></>}
    >
      {result ? (
        <div className="grid grid-cols-3 gap-2"><Mini label="Added" value={num(result.created)} /><Mini label="Updated" value={num(result.updated)} /><Mini label="Skipped" value={num(result.skipped)} /></div>
      ) : (
        <div className="space-y-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder={"Ravi Menon <ravi@menon.in>, Menon Traders\nmeena@meenasalon.in"} aria-label="Contacts" className="font-mono text-[12.5px]" />
          <SourceFields source={source} setSource={setSource} consent={consent} setConsent={setConsent} tags={tags} setTags={setTags} />
        </div>
      )}
    </Dialog>
  );
}

// ── Funnels ─────────────────────────────────────────────────────────────────

function FunnelsView() {
  const list = useAdmin<{ funnels: Funnel[] }>("outreach/funnels");
  const run = useRun();
  const can = useCan();
  const [edit, setEdit] = useState<Funnel | "new" | null>(null);
  if (list.isError) return <ErrorState message={errorMessage(list.error)} />;
  if (!list.data) return <Skeleton className="h-72" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted">Each person is in one running funnel at a time. Email steps that pick “best in category” let the engine choose for them.</p>
        {can("outreach:write") && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit("new")}>New funnel</Button>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {list.data.funnels.map((f) => (
          <Card key={f.id} className="min-w-0 space-y-3 p-4">
            <div className="flex items-start gap-3">
              <span className={cx("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px]", f.status === "active" ? "bg-success/12 text-success" : "bg-surface-2 text-muted")}>{f.kind === "broadcast" ? <Send className="size-4" /> : <GitBranch className="size-4" />}</span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(f)}>
                <p className="truncate text-[14px] font-semibold">{f.name}</p>
                <p className="truncate text-[12px] text-muted">{f.kind === "broadcast" ? "One-off broadcast" : `${f.steps.filter((s) => s.kind === "email").length} emails`} · goal: {STAGE_LABEL[f.goal]}{f.autoEnroll && f.kind === "funnel" ? " · new contacts join" : ""}</p>
              </button>
              {can("outreach:write") && (f.status === "active"
                ? <Button size="sm" icon={<Pause className="size-3.5" />} onClick={() => void run(`outreach/funnels/${f.id}/pause`, "POST", {}, "Paused")}>Pause</Button>
                : <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={async () => { const r = await run<{ enrolled: number }>(`outreach/funnels/${f.id}/start`, "POST"); if (r) await list.refetch(); }}>Start</Button>)}
            </div>
            {f.pausedReason && f.status !== "active" && <Notice tone="warning">{f.pausedReason}</Notice>}
            <div className="grid grid-cols-4 gap-2 text-[12px]">
              <Mini label="In it" value={num(f.active)} />
              <Mini label="Sent" value={num(f.sends)} />
              <Mini label="Click" value={pct(f.clicks, f.sends)} />
              <Mini label="Won" value={num(f.conversions)} />
            </div>
            {(f.control || f.revenue > 0 || f.priority > 0) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                {f.control && <span title={`${f.control.people} people held back`}>Lift <b className={cx("font-semibold tabular-nums", f.control.emailed > f.control.holdout ? "text-success" : "text-fg")}>{f.control.emailed > f.control.holdout ? "+" : ""}{Math.round((f.control.emailed - f.control.holdout) * 10) / 10} pts</b> vs not emailed ({f.control.emailed}% vs {f.control.holdout}%)</span>}
                {f.revenue > 0 && <span>₹{num(f.revenue)}/mo won</span>}
                {f.priority > 0 && <span>Priority {f.priority}</span>}
              </div>
            )}
            <StepStrip steps={f.steps} />
          </Card>
        ))}
      </div>
      {edit && <FunnelEditor funnel={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function StepStrip({ steps }: { steps: Step[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
      {steps.map((s, i) => (
        <span key={s.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-subtle">›</span>}
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5">
            {s.kind === "email" ? <><Mail className="size-3" />{s.category ? CATEGORY_LABEL[s.category] : "Email"}{s.resendAfterDays ? " + 2nd try" : ""}</> : s.kind === "wait" ? <><Hourglass className="size-3" />{s.days}d</> : <><GitBranch className="size-3" />If {s.if.replace("_", " ")}</>}
          </span>
        </span>
      ))}
    </div>
  );
}

const blankFunnel = (): Omit<Funnel, "id" | "key" | "status" | "pausedReason" | "control" | "revenue" | "enrolled" | "active" | "converted" | "sends" | "opens" | "clicks" | "conversions" | "unsubs" | "bounces"> => ({
  name: "",
  kind: "funnel",
  audience: { stages: ["new", "engaged", "hot"], industries: [], tags: [], sources: [], minScore: null },
  steps: [{ id: newId(), kind: "email", templateId: null, category: "intro" }, { id: newId(), kind: "wait", days: 3 }, { id: newId(), kind: "email", templateId: null, category: "feature" }],
  goal: "signed_up",
  autoEnroll: true,
  autoOptimize: true,
  priority: 0,
  holdoutPct: 5,
  startAt: null,
});

function Chips<T extends string>({ all, value, onChange, label }: { all: readonly T[]; value: T[]; onChange: (v: T[]) => void; label: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((x) => {
        const on = value.includes(x);
        return <button key={x} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== x) : [...value, x])} className={cx("rounded-full border px-2.5 py-1 text-[12px]", on ? "border-fg bg-fg text-bg" : "border-border text-muted hover:bg-surface-2")}>{label(x)}</button>;
      })}
    </div>
  );
}

function FunnelEditor({ funnel, onClose }: { funnel: Funnel | null; onClose: () => void }) {
  const run = useRun();
  const can = useCan();
  const tpl = useAdmin<{ templates: Template[] }>("outreach/templates");
  const detail = useAdmin<FunnelDetail>(`outreach/funnels/${funnel?.id ?? "none"}`, { enabled: !!funnel });
  const sources = useAdmin<{ sources: string[] }>("outreach/contacts?page=0");
  const [f, setF] = useState(() => (funnel ? { ...blankFunnel(), ...funnel, audience: { ...blankFunnel().audience, ...funnel.audience } } : blankFunnel()));
  const [tags, setTags] = useState(f.audience.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stats = (id: string) => detail.data?.steps.find((s) => s.id === id);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setAud = <K extends keyof Audience>(k: K, v: Audience[K]) => setF((x) => ({ ...x, audience: { ...x.audience, [k]: v } }));
  const setStep = (i: number, s: Step) => setF((x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? s : y)) }));
  const move = (i: number, d: number) => setF((x) => { const s = [...x.steps]; const [m] = s.splice(i, 1); s.splice(i + d, 0, m!); return { ...x, steps: s }; });
  const add = (kind: Step["kind"]) => setF((x) => ({ ...x, steps: [...x.steps, kind === "email" ? { id: newId(), kind, templateId: null, category: "feature" } : kind === "wait" ? { id: newId(), kind, days: 3 } : { id: newId(), kind, if: "clicked", then: x.steps[0]?.id ?? "", else: null }] }));
  const save = async () => {
    setBusy(true);
    const body = { name: f.name, kind: f.kind, audience: { ...f.audience, tags: tagList(tags) }, steps: f.steps, goal: f.goal, autoEnroll: f.autoEnroll, autoOptimize: f.autoOptimize, priority: f.priority, holdoutPct: f.holdoutPct, startAt: f.startAt };
    const r = await run(funnel ? `outreach/funnels/${funnel.id}` : "outreach/funnels", funnel ? "PUT" : "POST", body, "Saved");
    setBusy(false);
    if (r) onClose();
  };
  const write = can("outreach:write");
  const label = (s: Step, i: number) => `${i + 1}. ${s.kind === "email" ? "Email" : s.kind === "wait" ? "Wait" : "Branch"}`;
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={funnel ? funnel.name : "New funnel"}
      description={detail.data ? `${num(detail.data.audienceSize)} ${detail.data.audienceSize === 1 ? "contact matches" : "contacts match"} the audience right now.` : "Who it's for, what they get and when, and what counts as a win."}
      footer={write ? <>
        {funnel && (confirmDelete ? <Button variant="danger" onClick={async () => { if (await run(`outreach/funnels/${funnel.id}`, "DELETE", undefined, "Deleted")) onClose(); }}>Delete it and its history</Button> : <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>Delete</Button>)}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.steps.length} onClick={() => void save()}>Save</Button>
      </> : undefined}
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" className="sm:col-span-1">{(a) => <Input {...a} value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />}</Field>
          <Field label="Kind">{(a) => <Select {...a} value={f.kind} onChange={(e) => set("kind", e.target.value as Funnel["kind"])}><option value="funnel">Funnel (people flow through)</option><option value="broadcast">Broadcast (everyone once)</option></Select>}</Field>
          <Field label="Goal" hint="Reaching it takes them out.">{(a) => <Select {...a} value={f.goal} onChange={(e) => set("goal", e.target.value as Funnel["goal"])}>{GOALS.map((g) => <option key={g} value={g}>{STAGE_LABEL[g]}</option>)}</Select>}</Field>
        </div>

        <fieldset className="space-y-3 rounded-[14px] border border-border p-3">
          <legend className="px-1 text-[12px] font-medium text-muted">Audience</legend>
          <div className="space-y-1.5"><p className="text-[12px] text-muted">Stages</p><Chips all={STAGES} value={f.audience.stages} onChange={(v) => setAud("stages", v)} label={(s) => STAGE_LABEL[s]} /></div>
          <div className="space-y-1.5"><p className="text-[12px] text-muted">Industries (none = all)</p><Chips all={INDUSTRIES} value={f.audience.industries} onChange={(v) => setAud("industries", v)} label={cap} /></div>
          {!!sources.data?.sources.length && <div className="space-y-1.5"><p className="text-[12px] text-muted">Sources (none = all)</p><Chips all={sources.data.sources} value={f.audience.sources} onChange={(v) => setAud("sources", v)} label={(s) => s} /></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="With any of these tags">{(a) => <Input {...a} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="warm, pune" />}</Field>
            <Field label="Minimum score">{(a) => <Input {...a} type="number" min={0} value={f.audience.minScore ?? ""} onChange={(e) => setAud("minScore", e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))))} placeholder="Any" />}</Field>
          </div>
        </fieldset>

        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted">Steps</p>
          {f.steps.map((s, i) => {
            const st = stats(s.id);
            return (
              <Card key={s.id} className="min-w-0 space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-muted">{s.kind === "email" ? <Mail className="size-3.5" /> : s.kind === "wait" ? <Hourglass className="size-3.5" /> : <GitBranch className="size-3.5" />}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label(s, i)}</span>
                  {st && (st.sends > 0 || st.waiting > 0) && <span className="hidden truncate text-[11.5px] text-muted tabular-nums sm:inline">{st.waiting} here · {st.sends} sent · {pct(st.opens, st.sends)} open · {pct(st.clicks, st.sends)} click</span>}
                  <IconButton size="sm" label="Move up" disabled={!i} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></IconButton>
                  <IconButton size="sm" label="Move down" disabled={i === f.steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></IconButton>
                  <IconButton size="sm" label="Remove step" onClick={() => setF((x) => ({ ...x, steps: x.steps.filter((y) => y.id !== s.id) }))}><X className="size-3.5" /></IconButton>
                </div>
                {s.kind === "email" && (
                  <div className="space-y-2">
                  <Select value={s.templateId ? `t:${s.templateId}` : `c:${s.category ?? "intro"}`} onChange={(e) => { const [k, v] = [e.target.value.slice(0, 1), e.target.value.slice(2)]; setStep(i, { ...s, templateId: k === "t" ? v : null, category: k === "c" ? (v as TemplateCategory) : null }); }} aria-label="Which email">
                    <optgroup label="Best in category (the engine picks per person)">{TEMPLATE_CATEGORIES.map((c) => <option key={c} value={`c:${c}`}>Best {CATEGORY_LABEL[c].toLowerCase()}</option>)}</optgroup>
                    <optgroup label="A fixed template">{tpl.data?.templates.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}</optgroup>
                  </Select>
                  <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!s.resendAfterDays} onChange={(e) => setStep(i, { ...s, resendAfterDays: e.target.checked ? 3 : null })} />
                    Second try with another subject if unopened after
                    <Input type="number" min={1} max={14} value={s.resendAfterDays ?? 3} disabled={!s.resendAfterDays} onChange={(e) => setStep(i, { ...s, resendAfterDays: Math.min(14, Math.max(1, Math.round(Number(e.target.value) || 3))) })} className="!h-7 !w-16" aria-label="Days before the second try" />
                    days
                  </label>
                  </div>
                )}
                {s.kind === "wait" && (
                  <div className="flex items-center gap-2 text-[12.5px]"><Input type="number" min={0.04} max={60} step={0.5} value={s.days} onChange={(e) => setStep(i, { ...s, days: Math.min(60, Math.max(0.04, Number(e.target.value) || 1)) })} className="!w-24" aria-label="Days" /><span className="text-muted">days, then the next step at their best hour</span></div>
                )}
                {s.kind === "branch" && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Select value={s.if} onChange={(e) => setStep(i, { ...s, if: e.target.value as (typeof CONDITIONS)[number] })} aria-label="If">{CONDITIONS.map((c) => <option key={c} value={c}>If {CONDITION_LABEL[c].toLowerCase()}</option>)}</Select>
                    <Select value={s.then} onChange={(e) => setStep(i, { ...s, then: e.target.value })} aria-label="Then go to">{f.steps.map((y, j) => y.id !== s.id && <option key={y.id} value={y.id}>Then go to {label(y, j)}</option>)}</Select>
                    <Select value={s.else ?? ""} onChange={(e) => setStep(i, { ...s, else: e.target.value || null })} aria-label="Otherwise"><option value="">Otherwise carry on</option>{f.steps.map((y, j) => y.id !== s.id && <option key={y.id} value={y.id}>Otherwise go to {label(y, j)}</option>)}</Select>
                  </div>
                )}
              </Card>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Mail className="size-3.5" />} onClick={() => add("email")}>Email</Button>
            <Button size="sm" icon={<Hourglass className="size-3.5" />} onClick={() => add("wait")}>Wait</Button>
            <Button size="sm" icon={<GitBranch className="size-3.5" />} onClick={() => add("branch")}>Branch</Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {f.kind === "funnel" && <Toggle label="New contacts join on their own" sub="Anyone imported later who matches the audience." checked={f.autoEnroll} onChange={(v) => set("autoEnroll", v)} />}
          <Toggle label="Optimise on its own" sub="Learn the winning subject, template and hour, and shift sends to them." checked={f.autoOptimize} onChange={(v) => set("autoOptimize", v)} />
          <Field label="Priority" hint="0–100. Someone who matches a higher-priority funnel is moved into it.">{(a) => <Input {...a} type="number" min={0} max={100} value={f.priority} onChange={(e) => set("priority", Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))))} />}</Field>
          <Field label="Control group (%)" hint="Held back, never emailed — so you see the funnel's real lift. 5% is plenty.">{(a) => <Input {...a} type="number" min={0} max={30} value={f.holdoutPct} onChange={(e) => set("holdoutPct", Math.min(30, Math.max(0, Math.round(Number(e.target.value) || 0))))} />}</Field>
          <Field label="Start no earlier than" hint="Optional.">{(a) => <Input {...a} type="datetime-local" value={f.startAt ? toLocal(f.startAt) : ""} onChange={(e) => set("startAt", e.target.value ? new Date(e.target.value).toISOString() : null)} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

const toLocal = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

function Toggle({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[12px] border border-border p-3">
      <div className="min-w-0"><p className="text-[13px] font-medium">{label}</p>{sub && <p className="text-[12px] text-muted">{sub}</p>}</div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

function TemplatesView() {
  const list = useAdmin<{ templates: Template[] }>("outreach/templates");
  const can = useCan();
  const [cat, setCat] = useState<TemplateCategory | "">("");
  const [edit, setEdit] = useState<Template | "new" | null>(null);
  const [draft, setDraft] = useState<TemplateInput | null>(null);
  const [writing, setWriting] = useState(false);
  if (list.isError) return <ErrorState message={errorMessage(list.error)} />;
  if (!list.data) return <Skeleton className="h-72" />;
  const shown = list.data.templates.filter((t) => !cat || t.category === cat);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={cat} onChange={(e) => setCat(e.target.value as TemplateCategory | "")} aria-label="Category" className="!w-52"><option value="">Every category</option>{TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select>
        <span className="text-[12.5px] text-muted">{shown.length} templates</span>
        {can("outreach:write") && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => setWriting(true)}>Write with AI</Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => { setDraft(null); setEdit("new"); }}>New template</Button>
          </div>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((t) => {
          const lead = t.variants.length > 1 && t.variants.filter((_, i) => !t.retired.includes(i)).every((v) => v.sends >= 30) ? t.variants.reduce((a, v, i) => (v.clicks / v.sends > t.variants[a]!.clicks / t.variants[a]!.sends ? i : a), 0) : -1;
          return (
            <button key={t.id} type="button" onClick={() => setEdit(t)} className="min-w-0 rounded-[16px] border border-border bg-surface p-4 text-left hover:border-border-strong">
              <div className="flex items-center gap-2"><Badge>{CATEGORY_LABEL[t.category]}</Badge>{t.industries.length > 0 && <span className="truncate text-[11.5px] text-muted">{t.industries.map(cap).join(", ")}</span>}</div>
              <p className="mt-2 truncate text-[14px] font-semibold">{t.name}</p>
              <ul className="mt-1.5 space-y-1">
                {t.variants.map((v, i) => (
                  <li key={i} className="flex min-w-0 items-center gap-2 text-[12px]">
                    <span className={cx("min-w-0 flex-1 truncate", i === lead ? "font-medium" : "text-muted", t.retired.includes(i) && "line-through opacity-60")}>{i === lead && <Sparkles className="mr-1 inline size-3 text-accent" />}{v.subject}</span>
                    <span className="shrink-0 text-subtle tabular-nums">{v.sends ? pct(v.clicks, v.sends) : "new"}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11.5px] text-muted tabular-nums">{num(t.stats.sends)} sent · {pct(t.stats.opens, t.stats.sends)} open · {pct(t.stats.clicks, t.stats.sends)} click · {t.stats.conversions} won</p>
            </button>
          );
        })}
      </div>
      {edit && <TemplateEditor template={edit === "new" ? null : edit} draft={edit === "new" ? draft : null} onClose={() => { setEdit(null); setDraft(null); }} />}
      {writing && <AiWriter onClose={() => setWriting(false)} onDone={(t) => { setWriting(false); setDraft(t); setEdit("new"); }} />}
    </div>
  );
}

function TemplateEditor({ template, draft, onClose }: { template: Template | null; draft?: TemplateInput | null; onClose: () => void }) {
  const run = useRun();
  const can = useCan();
  const toast = useToast();
  const [t, setT] = useState<TemplateInput>(() => draft ? draft : template ? { name: template.name, category: template.category, industries: template.industries, subjects: template.subjects, preheader: template.preheader, body: template.body, ctaLabel: template.ctaLabel, ctaUrl: template.ctaUrl } : { name: "", category: "intro", industries: [], subjects: ["", ""], preheader: "", body: "Hi {{firstName|there}},\n\n", ctaLabel: "Start free", ctaUrl: "https://cloudesk.in/signup" });
  const [variant, setVariant] = useState(0);
  const [pv, setPv] = useState<{ subject: string; html: string } | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => setT((x) => ({ ...x, [k]: v }));
  const clean = { ...t, subjects: t.subjects.map((s) => s.trim()).filter(Boolean) };
  const ok = clean.name.trim() && clean.subjects.length && clean.body.trim();
  const body = JSON.stringify(clean);
  useEffect(() => {
    if (!ok) return;
    const id = setTimeout(() => {
      api<{ subject: string; html: string }>("/api/v1/admin/outreach/templates/preview", { method: "POST", body: { template: JSON.parse(body), variant: Math.min(variant, JSON.parse(body).subjects.length - 1) } }).then(setPv, () => {});
    }, 400);
    return () => clearTimeout(id);
  }, [body, variant, ok]);
  const write = can("outreach:write");
  const issues = useMemo(() => spamCheck(t), [t]);
  const editor = (
    <div className="min-w-0 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={t.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />}</Field>
        <Field label="Category">{(a) => <Select {...a} value={t.category} onChange={(e) => set("category", e.target.value as TemplateCategory)}>{TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select>}</Field>
      </div>
      <div className="space-y-1.5">
        <p className="text-[12px] font-medium text-muted">Subject lines <span className="font-normal">— the engine tests them against each other</span></p>
        {t.subjects.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={s} onChange={(e) => set("subjects", t.subjects.map((x, j) => (j === i ? e.target.value : x)))} onFocus={() => setVariant(i)} maxLength={160} aria-label={`Subject ${i + 1}`} placeholder={i ? "Another way to say it" : "{{firstName}}, …"} />
            {template?.retired.includes(i) ? <Badge>Retired</Badge> : template && template.variants[i]?.sends ? <span className="w-14 shrink-0 text-right text-[11.5px] text-muted tabular-nums">{pct(template.variants[i]!.clicks, template.variants[i]!.sends)}</span> : null}
            {t.subjects.length > 1 && <IconButton size="sm" label="Remove subject" onClick={() => set("subjects", t.subjects.filter((_, j) => j !== i))}><X className="size-3.5" /></IconButton>}
          </div>
        ))}
        {t.subjects.length < 6 && <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => set("subjects", [...t.subjects, ""])}>Subject line</Button>}
      </div>
      <Field label="Preview text" hint="Shown after the subject in most inboxes.">{(a) => <Input {...a} value={t.preheader} onChange={(e) => set("preheader", e.target.value)} maxLength={200} />}</Field>
      <Field label="Body" hint={<>**bold**, *italic*, [link](https://…), lines starting “- ”. Merge: {"{{firstName|there}} {{company}} {{city}} {{industry}} {{trial}}"} and any imported column.</>}>{(a) => <Textarea {...a} value={t.body} onChange={(e) => set("body", e.target.value)} rows={12} className="font-mono text-[12.5px]" />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Button text">{(a) => <Input {...a} value={t.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} maxLength={60} />}</Field>
        <Field label="Button link">{(a) => <Input {...a} value={t.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} maxLength={500} />}</Field>
      </div>
      <div className="space-y-1.5"><p className="text-[12px] text-muted">Best for (none = everyone)</p><Chips all={INDUSTRIES} value={t.industries} onChange={(v) => set("industries", v)} label={cap} /></div>
      <SpamPanel issues={issues} />
      {!!template?.links.length && (
        <div className="space-y-1">
          <p className="text-[12px] font-medium text-muted">What people click</p>
          {template.links.map((l) => <p key={l.url} className="flex gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate">{l.url.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}</span><span className="tabular-nums text-muted">{l.clicks}</span></p>)}
        </div>
      )}
    </div>
  );
  const preview = (
    <div className="min-w-0 space-y-2">
      <div className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px]"><span className="text-muted">Subject · </span><b className="font-medium break-words">{pv?.subject ?? "…"}</b></div>
      <iframe title="Email preview" sandbox="" srcDoc={pv?.html ?? ""} className="h-[520px] w-full rounded-[12px] border border-border bg-white" />
      {write && (
        <div className="flex gap-2">
          <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@company.com" aria-label="Send a test to" />
          <Button icon={<Send className="size-3.5" />} disabled={!ok || !/\S+@\S+\.\S+/.test(testTo)} onClick={async () => { const r = await run("outreach/templates/test", "POST", { template: clean, to: testTo, variant: Math.min(variant, clean.subjects.length - 1) }); if (r) toast({ tone: "success", title: `Test sent to ${testTo}` }); }}>Test</Button>
        </div>
      )}
    </div>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="2xl"
      title={template ? template.name : "New template"}
      description={template?.key ? "Built in. Your edits are kept." : "Write it once; the engine personalises and tests it."}
      footer={write ? <>
        {template && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await run(`outreach/templates/${template.id}`, "DELETE", undefined, "Archived")) onClose(); }}>Archive</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!ok} onClick={async () => { setBusy(true); const r = await run(template ? `outreach/templates/${template.id}` : "outreach/templates", template ? "PUT" : "POST", clean, "Saved"); setBusy(false); if (r) onClose(); }}>Save</Button>
      </> : undefined}
    >
      <div className="lg:hidden"><Tabs<"edit" | "preview"> value={tab} onChange={setTab} tabs={[{ value: "edit", label: "Write" }, { value: "preview", label: "Preview" }]} className="mb-3" /></div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cx("min-w-0", tab !== "edit" && "max-lg:hidden")}>{editor}</div>
        <div className={cx("min-w-0", tab !== "preview" && "max-lg:hidden")}>{preview}</div>
      </div>
    </Dialog>
  );
}

function AiWriter({ onClose, onDone }: { onClose: () => void; onDone: (t: TemplateInput) => void }) {
  const run = useRun();
  const [brief, setBrief] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("intro");
  const [industry, setIndustry] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Write a template with AI"
      description="Say who it's for and what you want them to do. You review and edit it before anything is sent."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Sparkles className="size-3.5" />} loading={busy} disabled={brief.trim().length < 5} onClick={async () => { setBusy(true); const r = await run<{ template: TemplateInput }>("outreach/templates/ai", "POST", { brief, category, industry }); setBusy(false); if (r) onDone(r.template); }}>Write it</Button></>}
    >
      <div className="space-y-3">
        <Field label="Brief">{(a) => <Textarea {...a} rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Restaurant owners in Pune who still bill on paper — get them to try the POS with QR menus, mention the free plan." />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">{(a) => <Select {...a} value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>{TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select>}</Field>
          <Field label="Industry">{(a) => <Select {...a} value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">Any</option>{INDUSTRIES.filter((x) => x !== "other").map((x) => <option key={x} value={x}>{cap(x)}</option>)}</Select>}</Field>
        </div>
      </div>
    </Dialog>
  );
}

function SpamPanel({ issues }: { issues: ReturnType<typeof spamCheck> }) {
  const bad = issues.filter((i) => i.level === "bad").length;
  return (
    <div className={cx("rounded-[12px] border p-3", bad ? "border-danger/40 bg-danger/5" : issues.some((i) => i.level === "warn") ? "border-warning/40 bg-warning/5" : "border-border bg-surface-2")}>
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium"><ShieldCheck className="size-3.5" />{issues.filter((i) => i.level !== "tip").length ? "Spam check: fix these before sending" : "Spam check: looks clean"}</p>
      {issues.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-[12px]">
          {issues.map((i, k) => <li key={k} className="flex gap-1.5"><span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", i.level === "bad" ? "bg-danger" : i.level === "warn" ? "bg-warning" : "bg-subtle")} /><span className="min-w-0 break-words">{i.text}</span></li>)}
        </ul>
      )}
    </div>
  );
}

// ── Activity ────────────────────────────────────────────────────────────────

const KIND_ICON: Record<string, ReactNode> = { open: <Mail className="size-3.5" />, click: <MousePointerClick className="size-3.5" />, signup: <Sparkles className="size-3.5" />, trial: <Sparkles className="size-3.5" />, paid: <Sparkles className="size-3.5" />, unsubscribe: <X className="size-3.5" />, bounce: <X className="size-3.5" /> };

function ActivityView() {
  const feed = useAdmin<{ events: { id: string; kind: string; detail: Record<string, unknown>; at: string; email: string | null; name: string | null; funnel: string | null }[] }>("outreach/activity?limit=200", { refetchInterval: 30_000 });
  if (feed.isError) return <ErrorState message={errorMessage(feed.error)} />;
  if (!feed.data) return <Skeleton className="h-72" />;
  if (!feed.data.events.length) return <Card className="p-10 text-center text-[13px] text-muted">Opens, clicks, sign-ups and unsubscribes appear here as they happen.</Card>;
  return (
    <Card className="divide-y divide-border">
      {feed.data.events.map((e) => (
        <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 text-[12.5px]">
          <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full", ["signup", "trial", "paid"].includes(e.kind) ? "bg-success/12 text-success" : ["unsubscribe", "bounce"].includes(e.kind) ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted")}>{KIND_ICON[e.kind] ?? <Activity className="size-3.5" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate"><b className="font-medium">{e.name || e.email || "Someone"}</b> {(EVENT_LABEL[e.kind] ?? cap(e.kind)).toLowerCase()}{e.kind === "import" && typeof e.detail.created === "number" ? ` ${e.detail.created} contacts` : ""}</span>
            <span className="block truncate text-[11.5px] text-muted">{[e.funnel, typeof e.detail.url === "string" ? e.detail.url : ""].filter(Boolean).join(" · ") || e.email}</span>
          </span>
          <span className="shrink-0 text-[11.5px] text-subtle">{ago(e.at)}</span>
        </div>
      ))}
    </Card>
  );
}

// ── Deliverability ──────────────────────────────────────────────────────────

type Check = { id: string; title: string; status: "pass" | "warn" | "fail"; detail: string; fix?: { type: string; host: string; value: string; note?: string } };

function DeliverabilityView() {
  const q = useAdmin<{ domain: string; from: string; via: string; checks: Check[]; score: number }>("outreach/deliverability");
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const d = q.data;
  const fails = d.checks.filter((c) => c.status === "fail").length;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className={cx("flex size-14 shrink-0 items-center justify-center rounded-full text-[18px] font-semibold tabular-nums", d.score >= 85 ? "bg-success/12 text-success" : d.score >= 60 ? "bg-warning/15 text-warning" : "bg-danger/10 text-danger")}>{d.score}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{fails ? `${fails} ${fails === 1 ? "thing" : "things"} will send mail to spam` : d.score >= 85 ? "Set up to reach the inbox" : "Nearly there"}</p>
          <p className="truncate text-[12.5px] text-muted">From {d.from || "—"} · checked live against {d.domain || "no domain"}’s DNS</p>
        </div>
        <Button size="sm" loading={q.isFetching} onClick={() => void q.refetch()}>Check again</Button>
      </Card>
      <Card className="divide-y divide-border">
        {d.checks.map((c) => (
          <div key={c.id} className="flex gap-3 p-3.5">
            <span className={cx("mt-1 size-2.5 shrink-0 rounded-full", c.status === "pass" ? "bg-success" : c.status === "warn" ? "bg-warning" : "bg-danger")} aria-label={c.status} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-[13.5px] font-medium">{c.title}</p>
              <p className="text-[12.5px] break-words text-muted">{c.detail}</p>
              {c.fix && c.status !== "pass" && <FixRecord fix={c.fix} />}
            </div>
          </div>
        ))}
      </Card>
      <Card className="space-y-2 p-4 text-[12.5px] text-muted">
        <p className="text-[13px] font-medium text-fg">The Cloudesk logo as the sender’s picture</p>
        <p><b className="font-medium text-fg">Gmail</b> shows a logo through BIMI (above, with a Mark Certificate) — or, without one, the profile photo of a Google account on the same address. Create a Google account for the From address (<a className="underline" href="https://accounts.google.com/signup" target="_blank" rel="noreferrer">“use my current email address instead”</a>) and set its photo to the logo below.</p>
        <p><b className="font-medium text-fg">Outlook and Apple Mail</b> show the BIMI logo once it’s verified; Yahoo shows it with DMARC enforcement alone.</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <a href="/brand/cloudesk-avatar.png" target="_blank" className="inline-flex items-center gap-2 rounded-[10px] border border-border px-2.5 py-1.5 hover:bg-surface-2"><Image src="/brand/cloudesk-avatar.png" alt="" width={24} height={24} className="size-6 rounded-full border border-border" />Profile picture (PNG)</a>
          <a href="/brand/bimi.svg" target="_blank" className="inline-flex items-center gap-2 rounded-[10px] border border-border px-2.5 py-1.5 hover:bg-surface-2">BIMI logo (SVG Tiny PS)</a>
        </div>
      </Card>
    </div>
  );
}

function FixRecord({ fix }: { fix: NonNullable<Check["fix"]> }) {
  const toast = useToast();
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast({ tone: "success", title: "Copied" });
    } catch {
      toast({ tone: "error", title: "Couldn't copy — select it instead" });
    }
  };
  return (
    <div className="rounded-[10px] bg-surface-2 p-2.5 text-[12px]">
      <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)]">
        <span className="text-subtle">Type</span><span>{fix.type}</span>
        <span className="text-subtle">{fix.type === "Webhook" ? "Where" : "Host"}</span><span className="font-mono break-all">{fix.host}</span>
        <span className="text-subtle">Value</span>
        <button type="button" onClick={() => void copy(fix.value)} className="text-left font-mono break-all hover:underline" title="Copy">{fix.value}</button>
      </div>
      {fix.note && <p className="mt-1.5 text-muted">{fix.note}</p>}
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function SettingsView() {
  const q = useAdmin<{ settings: Settings; mailboxes: Mailbox[] }>("outreach/settings");
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (!q.data) return <Skeleton className="h-72" />;
  return <SettingsForm initial={q.data.settings} mailboxes={q.data.mailboxes} />;
}

function SettingsForm({ initial, mailboxes }: { initial: Settings; mailboxes: Mailbox[] }) {
  const run = useRun();
  const can = useCan();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const n = (k: keyof Settings, min: number, max: number) => ({ type: "number", min, max, value: String(s[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Math.min(max, Math.max(min, Number(e.target.value) || min)) as never) });
  const write = can("outreach:write");
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-[10px]", s.sending ? "bg-success/12 text-success" : "bg-surface-2 text-muted")}><Send className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">Sending</p><p className="text-[12.5px] text-muted">{s.sending ? "Funnels send on their own every few minutes, inside the window below." : "Nothing is sent while this is off. Funnels keep their place."}</p></div>
        <Switch checked={s.sending} onChange={(v) => set("sending", v)} label="Sending" disabled={!write} />
      </Card>
      {s.sending && !s.postalAddress.trim() && <Notice tone="warning">A postal address is required before anything can be sent.</Notice>}
      <Section title="Sender" sub="Who the email comes from. Check Deliverability after changing it.">
        <div className="grid gap-2 sm:grid-cols-2">
          {([["platform", "Cloudesk email service", "Built for volume, signed for your domain. From any address on it, e.g. hello@cloudesk.in."], ["mailbox", "A Cloudesk Mail mailbox", `Sent as one of your own mailboxes in Cloudesk Mail. Personal, but capped at ${MAILBOX_DAILY_CAP} a day.`]] as const).map(([v, t, d]) => (
            <button key={v} type="button" aria-pressed={s.via === v} disabled={!write} onClick={() => set("via", v)} className={cx("min-w-0 rounded-[14px] border p-3 text-left", s.via === v ? "border-fg bg-surface-2" : "border-border hover:bg-surface-2")}>
              <p className="text-[13px] font-medium">{t}</p><p className="mt-0.5 text-[12px] text-muted">{d}</p>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From name">{(a) => <Input {...a} value={s.fromName} onChange={(e) => set("fromName", e.target.value)} maxLength={60} />}</Field>
          {s.via === "platform" ? (
            <Field label="From address" hint="Leave blank for the platform's own address. Must be on the domain your email service verified.">{(a) => <Input {...a} type="email" value={s.fromEmail} onChange={(e) => set("fromEmail", e.target.value.trim())} placeholder="hello@cloudesk.in" />}</Field>
          ) : (
            <Field label="Mailbox" hint={mailboxes.length ? "Your mailboxes connected in Cloudesk Mail." : "Connect your mailbox in Mail first (Mail → Add account)."}>{(a) => (
              <Select {...a} value={s.accountId ?? ""} onChange={(e) => set("accountId", e.target.value || null)}>
                <option value="">Choose a mailbox</option>
                {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.address}{m.status === "error" ? " (needs reconnecting)" : ""}</option>)}
              </Select>
            )}</Field>
          )}
          <Field label="Replies go to" hint="Leave blank for replies to reach the From address.">{(a) => <Input {...a} type="email" value={s.replyTo} onChange={(e) => set("replyTo", e.target.value)} />}</Field>
          <Field label="Postal address" hint="Shown in every email's footer — the law requires it." className="sm:col-span-2">{(a) => <Input {...a} value={s.postalAddress} onChange={(e) => set("postalAddress", e.target.value)} maxLength={300} placeholder="Company name, street, city, PIN" />}</Field>
        </div>
      </Section>
      <Section title="Volume" sub="New sending domains need warming up, or mail lands in spam.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Daily limit">{(a) => <Input {...a} {...n("dailyLimit", 1, 100_000)} />}</Field>
          <Field label="Never more often than (hours)" hint="Per person.">{(a) => <Input {...a} {...n("minGapHours", 1, 720)} />}</Field>
          <Field label="Stop after unopened in a row">{(a) => <Input {...a} {...n("sunsetAfter", 2, 20)} />}</Field>
          <Field label="At most a week, per person" hint="Across every funnel.">{(a) => <Input {...a} {...n("maxPerWeek", 1, 14)} />}</Field>
        </div>
        <Toggle label="Warm up" sub={`Start at ${s.warmupStart} a day and grow ${Math.round((s.warmupGrowth - 1) * 100)}% a day to the limit.`} checked={s.warmup} onChange={(v) => set("warmup", v)} />
        {s.warmup && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First day">{(a) => <Input {...a} {...n("warmupStart", 10, 10_000)} />}</Field>
            <Field label="Daily growth (×)">{(a) => <Input {...a} type="number" step={0.05} min={1} max={2} value={s.warmupGrowth} onChange={(e) => set("warmupGrowth", Math.min(2, Math.max(1, Number(e.target.value) || 1)))} />}</Field>
          </div>
        )}
      </Section>
      <Section title="When" sub="India time. Each person is sent at their own best hour inside this window once it's known.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From">{(a) => <Select {...a} value={s.windowStart} onChange={(e) => set("windowStart", Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select>}</Field>
          <Field label="Until">{(a) => <Select {...a} value={s.windowEnd} onChange={(e) => set("windowEnd", Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{String(h % 24).padStart(2, "0")}:00</option>)}</Select>}</Field>
        </div>
        <Chips all={["0", "1", "2", "3", "4", "5", "6"] as const} value={s.days.map(String) as ("0" | "1" | "2" | "3" | "4" | "5" | "6")[]} onChange={(v) => set("days", v.map(Number).sort())} label={(d) => DAYS[Number(d)]!} />
      </Section>
      <Section title="Autopilot" sub="What the engine does on its own.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle label="Write new subject lines with AI" sub="Once a day it retires subject lines that are clearly losing and writes a fresh challenger (on your workspace's AI allowance)." checked={s.aiEvolve} onChange={(v) => set("aiEvolve", v)} />
          <Toggle label="Tell me about replies and sign-ups" sub="An email the moment someone replies or signs up from outreach." checked={s.alerts} onChange={(v) => set("alerts", v)} />
        </div>
        {s.alerts && <Field label="Send alerts to" hint="Leave blank for your own address.">{(a) => <Input {...a} type="email" value={s.alertEmail} onChange={(e) => set("alertEmail", e.target.value.trim())} />}</Field>}
        <p className="text-[12px] text-muted">Always on: send-time learning, the best template and subject per person, hot leads moved to higher-priority funnels, address checks, ignoring machine opens and clicks, pausing risky funnels.</p>
      </Section>
      <Section title="Safety" sub="A funnel pauses itself when its last 200 sends cross these.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bounce rate above (%)">{(a) => <Input {...a} type="number" step={0.5} min={0.5} max={50} value={s.maxBounceRate} onChange={(e) => set("maxBounceRate", Math.min(50, Math.max(0.5, Number(e.target.value) || 5)))} />}</Field>
          <Field label="Unsubscribe rate above (%)">{(a) => <Input {...a} type="number" step={0.1} min={0.1} max={50} value={s.maxUnsubRate} onChange={(e) => set("maxUnsubRate", Math.min(50, Math.max(0.1, Number(e.target.value) || 2)))} />}</Field>
        </div>
      </Section>
      {write && (
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} disabled={s.windowEnd <= s.windowStart || !s.days.length} onClick={async () => { setBusy(true); const { startedAt: _, ...body } = s as Settings & { startedAt?: string | null; aiOrgId?: string | null; aiUserId?: string | null; lastDailyAt?: string | null }; void _; delete body.aiOrgId; delete body.aiUserId; delete body.lastDailyAt; await run("outreach/settings", "PUT", body, "Saved"); setBusy(false); }}>Save settings</Button>
        </div>
      )}
    </div>
  );
}
