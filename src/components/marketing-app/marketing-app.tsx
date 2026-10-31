"use client";

// Marketing: home (campaigns running, spend, deals influenced), campaigns
// (email: write, A/B subject, test, send or schedule, results per subject
// and link; event: registration page, registrations and check-in; ads and
// other: budget, spend and UTM links), segments with a live preview, and
// settings.
import { ArrowLeft, Copy, Home, Megaphone, Plus, Send, Settings, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Section, Stat } from "@/components/crm/shared";
import { ExportMenu } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, CAMPAIGN_STATUS_LABEL, type MktSettings } from "@/lib/marketing/model";
import { LIFECYCLE, SOURCE_LABEL } from "@/lib/crm/model";
import { formatPrice } from "@/lib/store/money";

type Meta = { me: { id: string; write: boolean; manage: boolean }; settings: MktSettings; owners: { id: string; name: string }[] };
type Rules = { lifecycle: string[]; sources: string[]; tagsAny: string[]; tagsAll: string[]; minScore: number | null; cities: string[]; countries: string[]; ownerIds: string[]; createdWithinDays: number | null; openDeal: "any" | "yes" | "no"; wonDeal: "any" | "yes" | "no" };
type Segment = { id: string; name: string; rules: Rules; count: number; mailable: number };
type EmailStat = { total: number; sent: number; failed: number; skipped: number; queued: number; clicked: number; clickRate: number | null; unsubscribed: number };
type Results = { reached: number; email: { all: EmailStat; A: EmailStat; B: EmailStat } | null; registered: number; attended: number; deals: number; firstValue: number; lastValue: number; linearValue: number; roi: number | null };
type Campaign = { id: string; name: string; kind: (typeof CAMPAIGN_KINDS)[number]; status: keyof typeof CAMPAIGN_STATUS_LABEL; segmentId: string | null; subject: string; subjectB: string; body: string; scheduledAt: string | null; sentAt: string | null; budget: number; spend: number; slug: string; startOn: string | null; endOn: string | null; eventAt: string | null; venue: string; onlineUrl: string; capacity: number; notes: string; regUrl: string | null; results?: Results };

const useMkt = () => useModule<Meta>();
const inr = (n: number) => formatPrice(n, "INR");
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 1000) / 10}%`);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const TONE: Record<string, string> = { draft: "bg-surface-2 text-muted", scheduled: "bg-accent-soft text-accent", sending: "bg-warning-soft text-warning", sent: "bg-success-soft text-success", active: "bg-success-soft text-success", ended: "bg-surface-2 text-muted", cancelled: "bg-surface-2 text-muted", registered: "bg-accent-soft text-accent", attended: "bg-success-soft text-success" };
const Pill = ({ s }: { s: string }) => <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", TONE[s] ?? "bg-surface-2 text-muted")}>{CAMPAIGN_STATUS_LABEL[s as keyof typeof CAMPAIGN_STATUS_LABEL] ?? s[0].toUpperCase() + s.slice(1)}</span>;
const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
const toPaise = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);

export function MarketingApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="marketing"
      base="marketing"
      title="Marketing"
      icon={<Send />}
      section={section}
      nav={(m) => [
        { id: "", label: "Home", icon: <Home /> },
        { id: "campaigns", label: "Campaigns", icon: <Megaphone />, group: "Reach" },
        { id: "segments", label: "Segments", icon: <Users /> },
        { id: "settings", label: "Settings", icon: <Settings />, group: "Setup", hidden: !m.me.manage },
      ]}
      render={() => {
        switch (section) {
          case "campaigns":
            return isId(id) ? <CampaignPage key={id} id={id!} /> : <CampaignsView />;
          case "segments":
            return <SegmentsView />;
          case "settings":
            return <SettingsView />;
          default:
            return <HomeView />;
        }
      }}
    />
  );
}

// ── Home ────────────────────────────────────────────────────────────────────

function HomeView() {
  const { go } = useMkt();
  const q = useModuleQuery<{ counts: { campaigns: number; drafts: number; sending: number; events: number }; spend: number; influenced: { deals: number; value: number }; recent: Campaign[]; upcomingEvents: Campaign[] }>("home");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Marketing" description="Campaigns going out, events coming up, and the won deals your campaigns touched." actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => go("campaigns")}>Campaign</Button>} />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Campaigns" value={d.counts.campaigns} sub={d.counts.drafts ? `${d.counts.drafts} draft${d.counts.drafts === 1 ? "" : "s"}` : undefined} />
            <Stat label="Sending or scheduled" value={d.counts.sending} />
            <Stat label="Spent" value={inr(d.spend)} />
            <Stat label="Won deals touched" value={d.influenced.deals} sub={inr(d.influenced.value)} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Recent campaigns">{!d.recent.length ? <Empty>No campaigns yet.</Empty> : <CampaignList rows={d.recent} compact />}</Section>
            <Section title="Events coming up">{!d.upcomingEvents.length ? <Empty>No events scheduled.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.upcomingEvents.map((e) => <li key={e.id} className="flex justify-between gap-3 py-2"><Link href={`/marketing/campaigns/${e.id}`} className="min-w-0 truncate hover:underline">{e.name}</Link><span className="shrink-0 text-muted">{when(e.eventAt)} · {e.results?.registered ?? 0} registered</span></li>)}</ul>}</Section>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Campaigns ───────────────────────────────────────────────────────────────

function CampaignList({ rows, compact }: { rows: Campaign[]; compact?: boolean }) {
  return (
    <ul className={cx("divide-y divide-border text-[13px]", !compact && "rounded-[20px] border border-border bg-surface px-4 shadow-sm")}>
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/marketing/campaigns/${c.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:opacity-80">
            <span className="min-w-0 flex-1"><b className="block truncate font-semibold">{c.name}</b><span className="text-[12px] text-muted">{CAMPAIGN_KIND_LABEL[c.kind]}{c.results?.email ? ` · ${c.results.email.all.sent} sent · ${pct(c.results.email.all.clickRate)} clicked` : c.kind === "event" ? ` · ${c.results?.registered ?? 0} registered` : ""}{c.results?.deals ? ` · ${c.results.deals} won deal${c.results.deals === 1 ? "" : "s"}` : ""}</span></span>
            <Pill s={c.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CampaignsView() {
  const { meta, go } = useMkt();
  const [kind, setKind] = useState("");
  const [adding, setAdding] = useState(false);
  const q = useModuleQuery<{ campaigns: Campaign[] }>(`campaigns${kind ? `?kind=${kind}` : ""}`, { keepPrevious: true });
  const rows = q.data?.campaigns ?? [];
  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Emails to a segment, events, and ads or anything else you spend on — each with what it reached and won."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="campaigns" columns={[{ key: "name", label: "Campaign" }, { key: "kind", label: "Kind" }, { key: "status", label: "Status" }, { key: "slug", label: "utm_campaign" }, { key: "sent", label: "Sent" }, { key: "clickRate", label: "Click rate %" }, { key: "registered", label: "Registered" }, { key: "attended", label: "Attended" }, { key: "budget", label: "Budget", money: true }, { key: "spend", label: "Spend", money: true }, { key: "deals", label: "Won deals touched" }, { key: "linearValue", label: "Won value (shared)", money: true }, { key: "roi", label: "ROI %" }]} rows={rows.map((c) => ({ ...c, kind: CAMPAIGN_KIND_LABEL[c.kind], status: CAMPAIGN_STATUS_LABEL[c.status], sent: c.results?.email?.all.sent ?? "", clickRate: c.results?.email?.all.clickRate === null || !c.results?.email ? "" : Math.round(c.results.email.all.clickRate * 1000) / 10, registered: c.results?.registered ?? 0, attended: c.results?.attended ?? 0, deals: c.results?.deals ?? 0, linearValue: c.results?.linearValue ?? 0, roi: c.results?.roi === null || c.results?.roi === undefined ? "" : Math.round(c.results.roi * 100) }))} />
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Campaign</Button>}
          </div>
        }
      />
      <Tabs value={kind} onChange={setKind} className="mb-5" tabs={[{ value: "", label: "All" }, ...CAMPAIGN_KINDS.map((k) => ({ value: k as string, label: CAMPAIGN_KIND_LABEL[k] }))]} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No campaigns yet.</Empty> : <CampaignList rows={rows} />}
      {adding && <NewCampaign onClose={() => setAdding(false)} onSaved={(id) => go(`campaigns/${id}`)} />}
    </div>
  );
}

function NewCampaign({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof CAMPAIGN_KINDS)[number]>("email");
  const save = useModuleAction<void, { campaign: Campaign }>(() => ({ path: "campaigns", body: { name, kind } }), { success: "Campaign made", onDone: (r) => (onClose(), onSaved(r.campaign.id)) });
  return (
    <Dialog open onClose={onClose} title="New campaign" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Create</Button></>}>
      <div className="grid gap-3">
        <Field label="Name">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali sale" />}</Field>
        <Field label="Kind">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{CAMPAIGN_KINDS.map((k) => <option key={k} value={k}>{CAMPAIGN_KIND_LABEL[k]}</option>)}</Select>}</Field>
      </div>
    </Dialog>
  );
}

type Detail = { campaign: Campaign; results: Results; links: { url: string; clicks: number; people: number }[]; segment: { id: string; name: string } | null; audienceNow: number | null; mailConfigured: boolean };

function CampaignPage({ id }: { id: string }) {
  const { meta, go } = useMkt();
  const q = useModuleQuery<Detail>(`campaigns/${id}`);
  const status = useModuleAction<string>((s) => ({ path: `campaigns/${id}/status`, body: { status: s } }), { success: "Updated" });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { campaign: c, results: r } = q.data;
  return (
    <div>
      <button type="button" onClick={() => go("campaigns")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Campaigns</button>
      <PageHeader
        title={c.name}
        description={`${CAMPAIGN_KIND_LABEL[c.kind]} · utm_campaign=${c.slug}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill s={c.status} />
            {meta.me.write && c.kind === "email" && ["draft", "scheduled"].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => status.mutate("cancelled")}>Cancel</Button>}
            {meta.me.write && c.kind !== "email" && c.status === "active" && <Button size="sm" variant="ghost" onClick={() => status.mutate("ended")}>End</Button>}
            {meta.me.write && c.kind !== "email" && c.status === "ended" && <Button size="sm" variant="ghost" onClick={() => status.mutate("active")}>Reopen</Button>}
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="People reached" value={r.reached} />
        {r.email ? <Stat label="Clicked" value={pct(r.email.all.clickRate)} sub={`${r.email.all.clicked} of ${r.email.all.sent} sent`} /> : c.kind === "event" ? <Stat label="Registered" value={r.registered} sub={`${r.attended} attended`} /> : <Stat label="Budget" value={inr(c.budget)} />}
        <Stat label="Spent" value={inr(c.spend)} sub={c.budget ? `of ${inr(c.budget)}` : undefined} tone={c.budget && c.spend > c.budget ? "warn" : undefined} />
        <Stat label="Won deals touched" value={r.deals} sub={r.roi === null ? inr(r.linearValue) : `${inr(r.linearValue)} · ROI ${Math.round(r.roi * 100)}%`} />
      </div>
      {c.kind === "email" ? <EmailCampaign d={q.data} /> : c.kind === "event" ? <EventCampaign d={q.data} /> : <OtherCampaign d={q.data} />}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <UtmBuilder id={c.id} />
        <Section title="Credit for won deals">
          <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-muted">First touch</dt><dd className="tabular-nums">{inr(r.firstValue)}</dd>
            <dt className="text-muted">Last touch</dt><dd className="tabular-nums">{inr(r.lastValue)}</dd>
            <dt className="text-muted">Shared evenly</dt><dd className="tabular-nums">{inr(r.linearValue)}</dd>
          </dl>
          <p className="mt-3 text-[12px] text-muted">Deals won within {meta.settings.attributionDays} days of this campaign reaching the contact (sent, clicked, registered, attended, or a form with its utm_campaign).</p>
        </Section>
      </div>
    </div>
  );
}

function EmailCampaign({ d }: { d: Detail }) {
  const { meta } = useMkt();
  const c = d.campaign;
  const editable = meta.me.write && ["draft", "scheduled"].includes(c.status);
  const segs = useModuleQuery<{ segments: Segment[] }>("segments");
  const [f, setF] = useState({ segmentId: c.segmentId ?? "", subject: c.subject, subjectB: c.subjectB, body: c.body, budget: c.budget ? String(c.budget / 100) : "", spend: c.spend ? String(c.spend / 100) : "" });
  const [ab, setAb] = useState(!!c.subjectB);
  const [at, setAt] = useState("");
  const [testTo, setTestTo] = useState("");
  const toast = useToast();
  const save = useModuleAction<void>(() => ({ path: `campaigns/${c.id}`, method: "PUT", body: { name: c.name, kind: c.kind, ...f, segmentId: f.segmentId || null, subjectB: ab ? f.subjectB : "", budget: toPaise(f.budget), spend: toPaise(f.spend) } }), { success: "Saved" });
  const send = useModuleAction<{ at?: string; test?: string }, { status?: string; recipients?: number; test?: boolean; emailed: boolean }>((b) => ({ path: `campaigns/${c.id}/send`, body: { at: b.at ?? null, ...(b.test ? { test: b.test } : {}) } }), { onDone: (r) => toast({ tone: "success", title: r.test ? (r.emailed ? "Test sent" : "Test recorded in the outbox (email isn't set up)") : r.status === "scheduled" ? "Scheduled" : `Sending to ${r.recipients} ${r.recipients === 1 ? "person" : "people"}` }) });
  const dirty = f.segmentId !== (c.segmentId ?? "") || f.subject !== c.subject || f.body !== c.body || (ab ? f.subjectB : "") !== c.subjectB;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Section title={editable ? "The email" : "What was sent"}>
        {!d.mailConfigured && editable && <div className="mb-3"><Notice tone="warning" title="Email isn't set up">Campaigns will be recorded in the outbox, not delivered, until the workspace&apos;s email is set up in Settings → Developer.</Notice></div>}
        <div className="grid gap-3">
          <Field label="To">{(p) => <Select {...p} disabled={!editable} value={f.segmentId} onChange={(e) => setF({ ...f, segmentId: e.target.value })}><option value="">Pick a segment</option>{(segs.data?.segments ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.mailable} can be emailed</option>)}</Select>}</Field>
          <Field label={ab ? "Subject A" : "Subject"}>{(p) => <Input {...p} disabled={!editable} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
          {editable && <Switch checked={ab} onChange={setAb} label="Try a second subject (half get each)" />}
          {ab && <Field label="Subject B">{(p) => <Input {...p} disabled={!editable} value={f.subjectB} onChange={(e) => setF({ ...f, subjectB: e.target.value })} />}</Field>}
          <Field label="Message" hint="Plain text. {{first_name}}, {{name}}, {{company}} are filled in; links are tracked; an unsubscribe line is added.">{(p) => <Textarea {...p} disabled={!editable} rows={12} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
          {meta.me.manage && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Budget (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />}</Field>
              <Field label="Spent (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} />}</Field>
            </div>
          )}
          {meta.me.write && <Button className="justify-self-start" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}
        </div>
      </Section>
      <div className="grid content-start gap-5">
        {editable ? (
          <Section title="Send">
            <p className="mb-3 text-[13px]">{d.audienceNow === null ? "Pick a segment first." : <>Goes to <b>{d.audienceNow}</b> {d.audienceNow === 1 ? "person" : "people"} who agreed to marketing.</>}</p>
            {dirty && <p className="mb-3 text-[12px] text-warning">Save your changes before sending.</p>}
            <div className="grid gap-2">
              <div className="flex gap-2"><Input aria-label="Send a test to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className="h-8 flex-1 text-[13px]" /><Button size="sm" disabled={!testTo.includes("@") || dirty} onClick={() => send.mutate({ test: testTo })}>Send test</Button></div>
              <Button variant="primary" icon={<Send className="size-3.5" />} disabled={dirty || !d.audienceNow || !f.subject.trim() || !f.body.trim()} loading={send.isPending} onClick={() => send.mutate({})}>Send now</Button>
              <div className="flex gap-2"><Input aria-label="Schedule for" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-8 flex-1 text-[13px]" /><Button size="sm" disabled={!at || dirty || !d.audienceNow} onClick={() => send.mutate({ at: new Date(at).toISOString() })}>Schedule</Button></div>
              {c.status === "scheduled" && <p className="text-[12px] text-muted">Scheduled for {when(c.scheduledAt)}.</p>}
            </div>
          </Section>
        ) : d.results.email ? (
          <Section title="Results">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-[12px] text-muted"><th className="py-1 font-medium" /><th className="py-1 text-right font-medium">Sent</th><th className="py-1 text-right font-medium">Clicked</th><th className="py-1 text-right font-medium">Unsub.</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(c.subjectB ? (["A", "B"] as const) : (["all"] as const)).map((k) => { const x = d.results.email![k]; return <tr key={k}><td className="py-1.5 pr-2">{k === "all" ? "Everyone" : `Subject ${k}`}</td><td className="py-1.5 text-right tabular-nums">{x.sent}</td><td className="py-1.5 text-right tabular-nums">{x.clicked} · {pct(x.clickRate)}</td><td className="py-1.5 text-right tabular-nums">{x.unsubscribed}</td></tr>; })}
              </tbody>
            </table>
            {d.results.email.all.queued > 0 && <p className="mt-2 text-[12px] text-muted">{d.results.email.all.queued} still to go.</p>}
            {(d.results.email.all.failed > 0 || d.results.email.all.skipped > 0) && <p className="mt-2 text-[12px] text-muted">{d.results.email.all.failed} failed, {d.results.email.all.skipped} skipped (unsubscribed or no longer agreeing).</p>}
            <p className="mt-3 text-[12px] text-muted">Opens aren&apos;t tracked: these are plain-text emails.</p>
          </Section>
        ) : null}
        {d.links.length > 0 && <Section title="Links clicked"><ul className="grid gap-1.5 text-[12.5px]">{d.links.map((l) => <li key={l.url} className="flex justify-between gap-2"><span className="min-w-0 truncate">{l.url}</span><span className="shrink-0 text-muted tabular-nums">{l.people} people · {l.clicks} clicks</span></li>)}</ul></Section>}
      </div>
    </div>
  );
}

function EventCampaign({ d }: { d: Detail }) {
  const { meta } = useMkt();
  const c = d.campaign;
  const toast = useToast();
  const regs = useModuleQuery<{ registrations: { id: string; name: string; email: string; phone: string; status: string; createdAt: string; attendedAt: string | null }[] }>(`campaigns/${c.id}/registrations`);
  const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 16) : "");
  const [f, setF] = useState({ eventAt: local(c.eventAt), venue: c.venue, onlineUrl: c.onlineUrl, capacity: c.capacity ? String(c.capacity) : "", notes: c.notes, budget: c.budget ? String(c.budget / 100) : "", spend: c.spend ? String(c.spend / 100) : "" });
  const save = useModuleAction<void>(() => ({ path: `campaigns/${c.id}`, method: "PUT", body: { name: c.name, kind: c.kind, eventAt: f.eventAt ? new Date(`${f.eventAt}:00+05:30`).toISOString() : null, venue: f.venue, onlineUrl: f.onlineUrl, capacity: Number(f.capacity) || 0, notes: f.notes, budget: toPaise(f.budget), spend: toPaise(f.spend) } }), { success: "Saved" });
  const attend = useModuleAction<{ registrationId: string; attended: boolean }>((b) => ({ path: `campaigns/${c.id}/attend`, body: b }));
  const rows = regs.data?.registrations ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Section title={`Registrations · ${rows.filter((r) => r.status !== "cancelled").length}${c.capacity ? ` of ${c.capacity}` : ""}`} action={<ExportMenu name={`${c.slug}-registrations`} columns={[{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "status", label: "Status" }, { key: "createdAt", label: "Registered" }, { key: "attendedAt", label: "Checked in" }]} rows={rows} />}>
        {!rows.length ? <Empty>Share the registration page; people who register appear here and in your CRM.</Empty> : (
          <ul className="divide-y divide-border text-[13px]">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1"><b className="block font-semibold">{r.name}</b><span className="text-[12px] text-muted">{r.email}{r.phone ? ` · ${r.phone}` : ""} · {when(r.createdAt)}</span></span>
                <Pill s={r.status} />
                {meta.me.write && <Button size="sm" variant={r.status === "attended" ? "ghost" : "secondary"} aria-label={`${r.status === "attended" ? "Undo check-in for" : "Check in"} ${r.name}`} onClick={() => attend.mutate({ registrationId: r.id, attended: r.status !== "attended" })}>{r.status === "attended" ? "Undo" : "Check in"}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="grid content-start gap-5">
        {c.regUrl && (
          <Section title="Registration page">
            <div className="flex items-center gap-2 rounded-[12px] border border-border px-3 py-2 text-[12.5px]"><span className="min-w-0 flex-1 truncate" data-testid="reg-url">{c.regUrl}</span><Button size="sm" variant="ghost" aria-label="Copy the registration link" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard?.writeText(c.regUrl!).then(() => toast({ tone: "success", title: "Link copied" }), () => {})} /></div>
            <a href={c.regUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12.5px] underline">Open it</a>
          </Section>
        )}
        <Section title="Details">
          <div className="grid gap-3">
            <Field label="When (IST)">{(p) => <Input {...p} type="datetime-local" disabled={!meta.me.write} value={f.eventAt} onChange={(e) => setF({ ...f, eventAt: e.target.value })} />}</Field>
            <Field label="Where">{(p) => <Input {...p} disabled={!meta.me.write} value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="A venue, or leave blank for online" />}</Field>
            <Field label="Online link">{(p) => <Input {...p} disabled={!meta.me.write} value={f.onlineUrl} onChange={(e) => setF({ ...f, onlineUrl: e.target.value })} placeholder="https://" />}</Field>
            <Field label="Places" hint="Blank for no limit">{(p) => <Input {...p} disabled={!meta.me.write} inputMode="numeric" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />}</Field>
            <Field label="About the event">{(p) => <Textarea {...p} disabled={!meta.me.write} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
            {meta.me.manage && <div className="grid grid-cols-2 gap-3"><Field label="Budget (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />}</Field><Field label="Spent (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} />}</Field></div>}
            {meta.me.write && <Button className="justify-self-start" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}
          </div>
        </Section>
      </div>
    </div>
  );
}

function OtherCampaign({ d }: { d: Detail }) {
  const { meta } = useMkt();
  const c = d.campaign;
  const [f, setF] = useState({ startOn: c.startOn ?? "", endOn: c.endOn ?? "", budget: c.budget ? String(c.budget / 100) : "", spend: c.spend ? String(c.spend / 100) : "", notes: c.notes });
  const save = useModuleAction<void>(() => ({ path: `campaigns/${c.id}`, method: "PUT", body: { name: c.name, kind: c.kind, startOn: f.startOn || null, endOn: f.endOn || null, budget: toPaise(f.budget), spend: toPaise(f.spend), notes: f.notes } }), { success: "Saved" });
  return (
    <Section title="Details">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts">{(p) => <Input {...p} type="date" disabled={!meta.me.write} value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} />}</Field>
        <Field label="Ends">{(p) => <Input {...p} type="date" disabled={!meta.me.write} value={f.endOn} onChange={(e) => setF({ ...f, endOn: e.target.value })} />}</Field>
        {meta.me.manage && <Field label="Budget (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />}</Field>}
        {meta.me.manage && <Field label="Spent (₹)" hint="From your ad accounts; they aren't connected">{(p) => <Input {...p} inputMode="decimal" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} />}</Field>}
        <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} disabled={!meta.me.write} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        {meta.me.write && <Button className="justify-self-start" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}
      </div>
    </Section>
  );
}

function UtmBuilder({ id }: { id: string }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [medium, setMedium] = useState("social");
  const [out, setOut] = useState("");
  const make = useModuleAction<void, { url: string }>(() => ({ path: `campaigns/${id}/utm`, body: { url, medium } }), { onDone: (r) => setOut(r.url) });
  return (
    <Section title="Tagged link">
      <div className="grid gap-2">
        <Input aria-label="Landing page" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.example/offer" className="h-8 text-[13px]" />
        <div className="flex gap-2">
          <Select aria-label="Medium" value={medium} onChange={(e) => setMedium(e.target.value)} className="h-8 flex-1 text-[13px]">{["social", "instagram", "facebook", "linkedin", "google", "whatsapp", "sms", "print", "partner", "email"].map((m) => <option key={m}>{m}</option>)}</Select>
          <Button size="sm" disabled={!/^https?:\/\//.test(url)} loading={make.isPending} onClick={() => make.mutate()}>Make link</Button>
        </div>
        {out && <div className="flex items-center gap-2 rounded-[12px] border border-border px-3 py-2 text-[12px]"><span className="min-w-0 flex-1 break-all">{out}</span><Button size="sm" variant="ghost" aria-label="Copy the tagged link" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard?.writeText(out).then(() => toast({ tone: "success", title: "Link copied" }), () => {})} /></div>}
        <p className="text-[12px] text-muted">Lead forms that send utm_campaign along credit this campaign.</p>
      </div>
    </Section>
  );
}

// ── Segments ────────────────────────────────────────────────────────────────

const EMPTY: Rules = { lifecycle: [], sources: [], tagsAny: [], tagsAll: [], minScore: null, cities: [], countries: [], ownerIds: [], createdWithinDays: null, openDeal: "any", wonDeal: "any" };

function SegmentsView() {
  const { meta } = useMkt();
  const q = useModuleQuery<{ segments: Segment[] }>("segments");
  const [editing, setEditing] = useState<Segment | "new" | null>(null);
  const rows = q.data?.segments ?? [];
  return (
    <div>
      <PageHeader title="Segments" description="Groups of CRM contacts by rules, worked out fresh each time you send." actions={meta.me.write ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Segment</Button> : undefined} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>Make a segment — say, leads tagged “VIP” in Pune with a score of 30 or more.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" disabled={!meta.me.write} onClick={() => setEditing(s)} className="flex w-full items-center gap-3 py-2.5 text-left disabled:cursor-default">
                <span className="min-w-0 flex-1"><b className="block font-semibold">{s.name}</b><span className="text-[12px] text-muted">{describe(s.rules)}</span></span>
                <span className="text-right text-[12px] tabular-nums"><b className="block text-[13px]">{s.count}</b><span className="text-muted">{s.mailable} can be emailed</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <SegmentDialog seg={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function describe(r: Rules) {
  const parts = [r.lifecycle.length && r.lifecycle.join(" or "), r.sources.length && `from ${r.sources.map((x) => SOURCE_LABEL[x] ?? x).join(" or ")}`, r.tagsAny.length && `tagged ${r.tagsAny.join(" or ")}`, r.tagsAll.length && `tagged ${r.tagsAll.join(" and ")}`, r.minScore !== null && `score ${r.minScore}+`, r.cities.length && `in ${r.cities.join(", ")}`, r.countries.length && r.countries.join(", "), r.createdWithinDays && `added in the last ${r.createdWithinDays} days`, r.openDeal !== "any" && (r.openDeal === "yes" ? "with an open deal" : "no open deal"), r.wonDeal !== "any" && (r.wonDeal === "yes" ? "has bought" : "hasn't bought")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Everyone in the CRM";
}

function SegmentDialog({ seg, onClose }: { seg?: Segment; onClose: () => void }) {
  const { meta } = useMkt();
  const [name, setName] = useState(seg?.name ?? "");
  const [r, setR] = useState<Rules>(seg?.rules ?? EMPTY);
  const [text, setText] = useState({ tagsAny: (seg?.rules.tagsAny ?? []).join(", "), tagsAll: (seg?.rules.tagsAll ?? []).join(", "), cities: (seg?.rules.cities ?? []).join(", "), countries: (seg?.rules.countries ?? []).join(", ") });
  const rules = { ...r, tagsAny: list(text.tagsAny), tagsAll: list(text.tagsAll), cities: list(text.cities), countries: list(text.countries) };
  const preview = useModuleAction<void, { count: number; mailable: number; sample: { id: string; name: string; email: string; mailable: boolean }[] }>(() => ({ path: "segments/preview", body: rules }), { onDone: (x) => setShown(x) });
  const [shown, setShown] = useState<{ count: number; mailable: number; sample: { id: string; name: string; email: string; mailable: boolean }[] } | null>(null);
  const save = useModuleAction<void>(() => ({ path: seg ? `segments/${seg.id}` : "segments", method: seg ? "PUT" : "POST", body: { name, rules } }), { success: "Segment saved", onDone: onClose });
  const del = useModuleAction<void>(() => ({ path: `segments/${seg!.id}`, method: "DELETE" }), { success: "Segment removed", onDone: onClose });
  const toggle = (k: "lifecycle" | "sources", v: string) => setR({ ...r, [k]: r[k].includes(v) ? r[k].filter((x) => x !== v) : [...r[k], v] });
  return (
    <Dialog open onClose={onClose} title={seg ? "Edit segment" : "New segment"} footer={<>{seg && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()}>Remove</Button>}<Button onClick={onClose}>Cancel</Button><Button loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button><Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <fieldset className="grid gap-1"><legend className="mb-1 text-[12.5px] font-medium">Lifecycle</legend><div className="flex flex-wrap gap-2">{LIFECYCLE.map((l) => <label key={l} className="flex items-center gap-1.5 text-[13px] capitalize"><input type="checkbox" checked={r.lifecycle.includes(l)} onChange={() => toggle("lifecycle", l)} className="accent-[var(--accent)]" />{l}</label>)}</div></fieldset>
        <fieldset className="grid gap-1"><legend className="mb-1 text-[12.5px] font-medium">Came from</legend><div className="flex flex-wrap gap-2">{Object.entries(SOURCE_LABEL).map(([k, v]) => <label key={k} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={r.sources.includes(k)} onChange={() => toggle("sources", k)} className="accent-[var(--accent)]" />{v}</label>)}</div></fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tagged with any of">{(p) => <Input {...p} value={text.tagsAny} onChange={(e) => setText({ ...text, tagsAny: e.target.value })} placeholder="vip, b2b" />}</Field>
          <Field label="Tagged with all of">{(p) => <Input {...p} value={text.tagsAll} onChange={(e) => setText({ ...text, tagsAll: e.target.value })} />}</Field>
          <Field label="Score at least">{(p) => <Input {...p} inputMode="numeric" value={r.minScore === null ? "" : String(r.minScore)} onChange={(e) => setR({ ...r, minScore: e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />}</Field>
          <Field label="Added in the last (days)">{(p) => <Input {...p} inputMode="numeric" value={r.createdWithinDays === null ? "" : String(r.createdWithinDays)} onChange={(e) => setR({ ...r, createdWithinDays: e.target.value === "" ? null : Math.max(1, Number(e.target.value) || 1) })} />}</Field>
          <Field label="City">{(p) => <Input {...p} value={text.cities} onChange={(e) => setText({ ...text, cities: e.target.value })} placeholder="Pune, Mumbai" />}</Field>
          <Field label="Country">{(p) => <Input {...p} value={text.countries} onChange={(e) => setText({ ...text, countries: e.target.value })} />}</Field>
          <Field label="Open deal">{(p) => <Select {...p} value={r.openDeal} onChange={(e) => setR({ ...r, openDeal: e.target.value as Rules["openDeal"] })}><option value="any">Doesn&apos;t matter</option><option value="yes">Has one</option><option value="no">Has none</option></Select>}</Field>
          <Field label="Won deal">{(p) => <Select {...p} value={r.wonDeal} onChange={(e) => setR({ ...r, wonDeal: e.target.value as Rules["wonDeal"] })}><option value="any">Doesn&apos;t matter</option><option value="yes">Has bought</option><option value="no">Hasn&apos;t bought</option></Select>}</Field>
          <Field label="Owner" className="sm:col-span-2">{(p) => <Select {...p} value={r.ownerIds[0] ?? ""} onChange={(e) => setR({ ...r, ownerIds: e.target.value ? [e.target.value] : [] })}><option value="">Anyone</option>{meta.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}</Field>
        </div>
        {shown && (
          <div className="rounded-[14px] bg-surface-2 p-3 text-[13px]">
            <p><b>{shown.count}</b> {shown.count === 1 ? "contact" : "contacts"} · <b>{shown.mailable}</b> can be emailed</p>
            {shown.sample.length > 0 && <ul className="mt-2 grid gap-0.5 text-[12px] text-muted">{shown.sample.slice(0, 8).map((c) => <li key={c.id}>{c.name || c.email}{!c.mailable ? " (not for marketing)" : ""}</li>)}</ul>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function SettingsView() {
  const { meta } = useMkt();
  const [f, setF] = useState(meta.settings);
  const save = useModuleAction<void>(() => ({ path: "settings", method: "PUT", body: f }), { success: "Saved" });
  return (
    <div className="grid max-w-2xl gap-5">
      <PageHeader title="Marketing settings" />
      <Section title="Sending and tracking">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From name" hint="Your business name if blank">{(p) => <Input {...p} value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} />}</Field>
          <Field label="Replies go to">{(p) => <Input {...p} type="email" value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} />}</Field>
          <Field label="utm_source for tagged links">{(p) => <Input {...p} value={f.utmSource} onChange={(e) => setF({ ...f, utmSource: e.target.value })} />}</Field>
          <Field label="Credit deals won within (days)">{(p) => <Input {...p} inputMode="numeric" value={String(f.attributionDays)} onChange={(e) => setF({ ...f, attributionDays: Number(e.target.value) || 1 })} />}</Field>
        </div>
      </Section>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}
