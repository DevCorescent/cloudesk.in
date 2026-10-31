"use client";

// Mail settings: mailboxes (status, sync, edit, remove), rules, templates,
// keyboard shortcuts and what the AI does.
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pause, Play, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import type { ImportResult } from "@/components/import/smart-import";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, EmptyState, Field, IconButton, Input, Kbd, Notice, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { Keys } from "@/components/ui/shortcut";
import { errorMessage } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import type { AccountOut, MetaOut, RuleOut, TemplateOut } from "@/lib/mail/api";
import { CATEGORIES, CATEGORY_LABEL, providerOf } from "@/lib/mail/model";
import { ProviderMark, SWATCHES } from "./connect";
import { SignatureSettings } from "./signatures";
import { longTime, mailKey, useMailApi, useMailRefresh } from "./shared";

type Tab = "mailboxes" | "signatures" | "rules" | "templates" | "shortcuts" | "ai";

export const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous conversation"],
  ["enter / o", "Open"],
  ["e", "Archive"],
  ["#", "Move to trash"],
  ["s", "Star or unstar"],
  ["u", "Mark unread"],
  ["r", "Reply"],
  ["a", "Reply all"],
  ["f", "Forward"],
  ["c", "Compose"],
  ["/", "Search"],
  ["x", "Select"],
  ["l", "Label"],
  ["b", "Snooze"],
  ["esc", "Close / clear selection"],
  ["n", "Save the conversation to Notes"],
  ["v", "Read the conversation full screen"],
  ["left / right", "Previous / next conversation (full screen)"],
  ["?", "Show shortcuts"],
  ["mod+enter", "Send (while writing)"],
];

export function MailSettings({ meta, onAdd }: { meta: MetaOut; onAdd: () => void }) {
  const asked = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(asked === "signatures" || asked === "rules" || asked === "templates" ? asked : "mailboxes");
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
      <Link href="/mail" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Back to mail</Link>
      <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.02em]">Mail settings</h1>
      <Tabs className="mt-4" value={tab} onChange={setTab} tabs={[{ value: "mailboxes", label: "Mailboxes" }, { value: "signatures", label: "Signatures" }, { value: "rules", label: "Rules" }, { value: "templates", label: "Templates" }, { value: "shortcuts", label: "Shortcuts" }, { value: "ai", label: "AI" }]} />
      <div className="mt-5">
        {tab === "mailboxes" && <Mailboxes meta={meta} onAdd={onAdd} />}
        {tab === "signatures" && <SignatureSettings meta={meta} />}
        {tab === "rules" && <Rules meta={meta} />}
        {tab === "templates" && <Templates meta={meta} />}
        {tab === "shortcuts" && <ShortcutList />}
        {tab === "ai" && <AiInfo meta={meta} />}
      </div>
    </div>
  );
}

export function ShortcutList() {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {SHORTCUTS.map(([k, v]) => (
        <li key={k} className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-[13px] odd:bg-surface-2/60">
          <span>{v}</span>
          <Keys k={k} always />
        </li>
      ))}
    </ul>
  );
}

function Mailboxes({ meta, onAdd }: { meta: MetaOut; onAdd: () => void }) {
  const { call } = useMailApi();
  const refresh = useMailRefresh();
  const toast = useToast();
  const [edit, setEdit] = useState<AccountOut | null>(null);
  const [remove, setRemove] = useState<AccountOut | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  // Sends for real, from the mailbox to itself, and reports what its mail server said.
  const test = async (a: AccountOut) => {
    setTesting(a.id);
    try {
      const r = await call<{ sent: boolean; to: string; server: string; error?: string }>(`accounts/${a.id}/test`, "POST");
      toast(r.sent ? { tone: "success", title: `Test email sent to ${r.to}`, description: `${r.server} accepted it. It shows in your inbox at the next sync — that's delivery confirmed end to end.` } : { tone: "error", title: "The test email didn't go", description: r.error });
      void refresh();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setTesting(null);
    }
  };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast({ tone: "success", title: done });
      void refresh();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  return (
    <div className="grid gap-3">
      {meta.accounts.length === 0 && <EmptyState title="No mailboxes yet" description="Connect one to start." action={<Button variant="primary" onClick={onAdd}>Add a mailbox</Button>} />}
      {meta.accounts.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-border bg-surface p-4">
          <ProviderMark id={a.provider} />
          <div className="min-w-0 flex-1 basis-[220px]">
            <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
              <span className="size-2.5 rounded-full" style={{ background: a.color }} />
              {a.name}
              {a.shared && <Badge tone="accent">Team inbox</Badge>}
              {a.settings.autoReply?.enabled && <Badge tone="warning">Auto-reply on</Badge>}
              {a.settings.slaHours && <Badge>Reply within {a.settings.slaHours < 24 ? `${a.settings.slaHours}h` : `${a.settings.slaHours / 24}d`}</Badge>}
              <Badge tone={a.status === "active" ? "success" : a.status === "error" ? "danger" : a.status === "paused" ? "neutral" : "warning"}>{a.status === "active" ? "Connected" : a.status === "error" ? "Needs attention" : a.status === "paused" ? "Paused" : "Connecting"}</Badge>
            </p>
            <p className="text-[12.5px] text-muted">{a.address} · {providerOf(a.provider)?.name ?? a.provider}{a.lastSyncAt ? ` · synced ${longTime(a.lastSyncAt)}` : ""}</p>
            {a.lastError && <p className="mt-1 text-[12.5px] text-danger">{a.lastError}</p>}
          </div>
          {(a.mine || meta.me.manage) && (
            <div className="flex items-center gap-1">
              <Button size="sm" icon={<Send className="size-3.5" />} loading={testing === a.id} disabled={a.status === "paused"} onClick={() => void test(a)}>Send a test</Button>
              <IconButton label="Sync now" icon={<RefreshCw className="size-4" />} onClick={() => void run(() => call(`accounts/${a.id}/sync`, "POST"), "Syncing")} />
              <IconButton label={a.status === "paused" ? "Resume" : "Pause"} icon={a.status === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />} onClick={() => void run(() => call(`accounts/${a.id}`, "PATCH", { paused: a.status !== "paused" }), a.status === "paused" ? "Resumed" : "Paused")} />
              <Button size="sm" onClick={() => setEdit(a)}>Edit</Button>
              <IconButton label={`Remove ${a.address}`} icon={<Trash2 className="size-4" />} onClick={() => setRemove(a)} />
            </div>
          )}
        </div>
      ))}
      {meta.accounts.length > 0 && <Button className="w-fit" icon={<Plus className="size-4" />} onClick={onAdd}>Add another mailbox</Button>}
      {edit && <EditAccount account={edit} meta={meta} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} destructive title={`Remove ${remove?.address}?`} description="Its mail is removed from Cloudesk. Nothing is deleted in the mailbox itself." confirmLabel="Remove" onConfirm={() => remove && void run(() => call(`accounts/${remove.id}`, "DELETE"), "Mailbox removed").then(() => setRemove(null))} />
    </div>
  );
}

function EditAccount({ account: a, meta, onClose }: { account: AccountOut; meta: MetaOut; onClose: () => void }) {
  const { call } = useMailApi();
  const refresh = useMailRefresh();
  const toast = useToast();
  const [v, setV] = useState({ name: a.name, displayName: a.displayName, color: a.color, signature: a.signature, syncDays: a.settings.syncDays, sendDelaySec: a.settings.sendDelaySec, aiTriage: a.settings.aiTriage, slaHours: a.settings.slaHours, autoAddMeetings: a.settings.autoAddMeetings, shared: a.shared, members: a.members, password: "" });
  const prevAuto = a.settings.autoReply;
  const [auto, setAuto] = useState({ enabled: prevAuto?.enabled ?? false, from: prevAuto?.from ?? "", until: prevAuto?.until ?? "", subject: prevAuto?.subject ?? "", body: prevAuto?.body || "Hi {{first_name}},\n\nThanks for your email. I'm away and back on Monday, with limited access to mail. For anything urgent, please call the office.\n\nThanks", onlyKnown: prevAuto?.onlyKnown ?? false });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const autoReply = auto.enabled || prevAuto ? { ...auto, tzOffset: -new Date().getTimezoneOffset() } : undefined;
      await call(`accounts/${a.id}`, "PATCH", { ...v, password: v.password || undefined, autoReply });
      toast({ tone: "success", title: "Saved" });
      void refresh();
      onClose();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={`Edit ${a.address}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mailbox name">{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <Field label="Your name on sent mail">{(p) => <Input {...p} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />}</Field>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Colour</p>
          <div className="flex flex-wrap gap-2">{SWATCHES.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={c === v.color} onClick={() => setV({ ...v, color: c })} className={cx("size-7 rounded-full ring-offset-2 ring-offset-[var(--bg)]", c === v.color && "ring-2 ring-fg")} style={{ background: c }} />)}</div>
        </div>
        <Field label="Plain signature" hint="Used only until you make a designed one in Signatures">{(p) => <Textarea {...p} rows={4} value={v.signature} onChange={(e) => setV({ ...v, signature: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Undo send window" hint="How long you can call a message back">{(p) => <Select {...p} value={v.sendDelaySec} onChange={(e) => setV({ ...v, sendDelaySec: Number(e.target.value) })}>{[0, 5, 10, 20, 30].map((s) => <option key={s} value={s}>{s ? `${s} seconds` : "Off — send at once"}</option>)}</Select>}</Field>
          <Field label="History to keep in sync">{(p) => <Select {...p} value={v.syncDays} onChange={(e) => setV({ ...v, syncDays: Number(e.target.value) })}>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d === 365 ? "1 year" : `${d} days`}</option>)}</Select>}</Field>
        </div>
        <Field label="Reply target" hint="Personal mail waiting longer than this shows as overdue, and analytics count how often you make it">{(p) => <Select {...p} value={v.slaHours ?? ""} onChange={(e) => setV({ ...v, slaHours: e.target.value ? Number(e.target.value) : null })}><option value="">No target</option>{[1, 2, 4, 8, 24, 48, 72].map((h) => <option key={h} value={h}>{h < 24 ? `Within ${h} ${h === 1 ? "hour" : "hours"}` : `Within ${h / 24} ${h === 24 ? "day" : "days"}`}</option>)}</Select>}</Field>
        <label className="flex items-start justify-between gap-3 text-[13.5px]">
          <span><span className="font-medium">Add meeting invites to my calendar automatically</span><span className="block text-[12.5px] text-muted">Calendar invites (Google, Outlook, Zoom, Teams) go straight into your calendar with reminders. Off: they wait in Mail → Meetings for you to add.</span></span>
          <Switch label="Add meeting invites automatically" checked={v.autoAddMeetings} onChange={(x) => setV({ ...v, autoAddMeetings: x })} />
        </label>
        <div className={cx("rounded-[16px] border p-4 transition-colors", auto.enabled ? "border-sky-500/30 bg-sky-500/[0.04]" : "border-border")}>
          <label className="flex items-start justify-between gap-3 text-[13.5px]">
            <span><span className="font-medium">Auto-reply (out of office)</span><span className="block text-[12.5px] text-muted">Answers new mail once per sender every few days. Never to mailing lists, no-reply addresses or other auto-replies.</span></span>
            <Switch label="Auto-reply" checked={auto.enabled} onChange={(x) => setAuto({ ...auto, enabled: x })} />
          </label>
          {auto.enabled && (
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From" hint="Empty: starting now">{(p) => <Input {...p} type="date" value={auto.from} onChange={(e) => setAuto({ ...auto, from: e.target.value })} />}</Field>
                <Field label="Until" hint="Empty: until you turn it off">{(p) => <Input {...p} type="date" value={auto.until} min={auto.from || undefined} onChange={(e) => setAuto({ ...auto, until: e.target.value })} />}</Field>
              </div>
              <Field label="Subject" hint="Empty: “Re:” and their subject">{(p) => <Input {...p} value={auto.subject} onChange={(e) => setAuto({ ...auto, subject: e.target.value })} />}</Field>
              <Field label="Message" hint="{{first_name}} and {{my_name}} are filled in; your signature is added">{(p) => <Textarea {...p} rows={5} value={auto.body} onChange={(e) => setAuto({ ...auto, body: e.target.value })} />}</Field>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={auto.onlyKnown} onChange={(e) => setAuto({ ...auto, onlyKnown: e.target.checked })} className="size-4 accent-sky-600" /> Only reply to people I&apos;ve written to, or who are in the CRM</label>
            </div>
          )}
        </div>
        <label className="flex items-start justify-between gap-3 text-[13.5px]">
          <span><span className="font-medium">Sort new mail with AI</span><span className="block text-[12.5px] text-muted">{meta.aiAvailable ? "Uses your workspace's AI budget for each new email. Rules-based sorting is always on." : "Needs an AI provider (Settings → AI providers). Rules-based sorting is always on."}</span></span>
          <Switch label="Sort new mail with AI" checked={v.aiTriage} disabled={!meta.aiAvailable} onChange={(x) => setV({ ...v, aiTriage: x })} />
        </label>
        {meta.me.manage && (
          <div className="rounded-[14px] border border-border p-3">
            <label className="flex items-center justify-between gap-3 text-[13.5px] font-medium">Team inbox <Switch label="Team inbox" checked={v.shared} onChange={(x) => setV({ ...v, shared: x })} /></label>
            {v.shared && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {meta.members.filter((m) => m.id !== a.ownerId).map((m) => (
                  <button key={m.id} type="button" aria-pressed={v.members.includes(m.id)} onClick={() => setV({ ...v, members: v.members.includes(m.id) ? v.members.filter((x) => x !== m.id) : [...v.members, m.id] })} className={cx("h-7 rounded-full px-3 text-[12.5px] ring-1", v.members.includes(m.id) ? "bg-accent/10 text-accent ring-accent/40" : "ring-border")}>{m.name || m.email}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {a.auth === "password" && <Field label="New password" hint="Only if it changed — leave empty to keep the saved one">{(p) => <Input {...p} type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />}</Field>}
      </div>
    </Dialog>
  );
}

// ── Rules ───────────────────────────────────────────────────────────────────

const FIELDS = [["from", "Sender"], ["to", "Recipient"], ["subject", "Subject"], ["body", "Message text"], ["category", "Category"], ["hasAttachment", "Has attachment"]] as const;
const OPS: Record<string, [string, string][]> = { from: [["contains", "contains"], ["equals", "is"], ["domain", "is from domain"]], to: [["contains", "contains"], ["equals", "is"]], subject: [["contains", "contains"], ["equals", "is"]], body: [["contains", "contains"]], category: [["is", "is"]], hasAttachment: [["is", "is"]] };
const ACTIONS = [["label", "Add label"], ["category", "Move to category"], ["archive", "Skip the inbox (archive)"], ["star", "Star it"], ["read", "Mark as read"], ["priority", "Set priority"], ["assign", "Assign to"], ["trash", "Move to trash"], ["ticket", "Create a helpdesk ticket"], ["contact", "Add sender to CRM"]] as const;
const NEEDS_VALUE = new Set(["label", "category", "priority", "assign"]);
type RuleForm = { name: string; accountId: string | null; match: "all" | "any"; conditions: { field: string; op: string; value: string }[]; actions: { type: string; value: string }[]; enabled: boolean };

function Rules({ meta }: { meta: MetaOut }) {
  const { orgId, call } = useMailApi();
  const toast = useToast();
  const q = useQuery({ queryKey: mailKey(orgId, "rules"), queryFn: () => call<{ rules: RuleOut[] }>("rules") });
  const [edit, setEdit] = useState<{ id: string | null; f: RuleForm } | null>(null);
  const reload = () => void q.refetch();
  const toggle = async (r: RuleOut) => {
    try {
      await call(`rules/${r.id}`, "PUT", { ...r, enabled: !r.enabled });
      reload();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-muted">Rules run on every new email, in order, before it reaches your inbox.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ id: null, f: { name: "", accountId: null, match: "all", conditions: [{ field: "from", op: "contains", value: "" }], actions: [{ type: "label", value: "" }], enabled: true } })}>New rule</Button>
      </div>
      {!q.data ? <Skeleton className="h-32" /> : !q.data.rules.length ? (
        <EmptyState title="No rules yet" description="For example: mail from your accountant's domain → label “Accounts” and star it." />
      ) : (
        q.data.rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-surface p-4 text-[13.5px]">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{r.name} {!r.enabled && <Badge>Off</Badge>}</p>
              <p className="text-[12.5px] text-muted">If {r.match === "all" ? "all" : "any"}: {r.conditions.map((c) => `${FIELDS.find((x) => x[0] === c.field)?.[1] ?? c.field} ${c.op} “${c.value}”`).join(r.match === "all" ? " and " : " or ")} → {r.actions.map((a) => `${ACTIONS.find((x) => x[0] === a.type)?.[1] ?? a.type}${a.value ? ` “${a.value}”` : ""}`).join(", ")}</p>
              <p className="text-[12px] text-subtle">Used {r.hits} time{r.hits === 1 ? "" : "s"}{r.accountId ? ` · ${meta.accounts.find((a) => a.id === r.accountId)?.address ?? "one mailbox"}` : " · all your mailboxes"}</p>
            </div>
            <Switch label={`${r.name} on`} checked={r.enabled} onChange={() => void toggle(r)} />
            <Button size="sm" onClick={() => setEdit({ id: r.id, f: { name: r.name, accountId: r.accountId, match: r.match, conditions: r.conditions, actions: r.actions, enabled: r.enabled } })}>Edit</Button>
            <IconButton label={`Delete ${r.name}`} icon={<Trash2 className="size-4" />} onClick={async () => {
              try {
                await call(`rules/${r.id}`, "DELETE");
                reload();
              } catch (e) {
                toast({ tone: "error", title: errorMessage(e) });
              }
            }} />
          </div>
        ))
      )}
      {edit && <RuleEditor meta={meta} id={edit.id} initial={edit.f} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

function RuleEditor({ meta, id, initial, onClose, onSaved }: { meta: MetaOut; id: string | null; initial: RuleForm; onClose: () => void; onSaved: () => void }) {
  const { call } = useMailApi();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await call(id ? `rules/${id}` : "rules", id ? "PUT" : "POST", f);
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const setCond = (i: number, patch: Partial<RuleForm["conditions"][number]>) => setF({ ...f, conditions: f.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setAct = (i: number, patch: Partial<RuleForm["actions"][number]>) => setF({ ...f, actions: f.actions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const valueInput = (c: RuleForm["conditions"][number], i: number) =>
    c.field === "category" ? (
      <Select aria-label="Category" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}>{CATEGORIES.map((x) => <option key={x} value={x}>{CATEGORY_LABEL[x]}</option>)}</Select>
    ) : c.field === "hasAttachment" ? (
      <Select aria-label="Has attachment" value={c.value || "true"} onChange={(e) => setCond(i, { value: e.target.value })}><option value="true">Yes</option><option value="false">No</option></Select>
    ) : (
      <Input aria-label="Value" value={c.value} placeholder={c.op === "domain" ? "example.com" : "text"} onChange={(e) => setCond(i, { value: e.target.value })} />
    );
  return (
    <Dialog open onClose={onClose} size="xl" title={id ? "Edit rule" : "New rule"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save rule</Button></>}>
      <div className="grid gap-4">
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rule name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Supplier bills" />}</Field>
          <Field label="Applies to">{(p) => <Select {...p} value={f.accountId ?? ""} onChange={(e) => setF({ ...f, accountId: e.target.value || null })}><option value="">All my mailboxes</option>{meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.address}</option>)}</Select>}</Field>
        </div>
        <div className="rounded-[16px] border border-border p-4">
          <p className="mb-2 flex flex-wrap items-center gap-2 text-[13.5px] font-medium">When an email matches <Select aria-label="Match" value={f.match} onChange={(e) => setF({ ...f, match: e.target.value as "all" | "any" })} className="!w-auto"><option value="all">all</option><option value="any">any</option></Select> of these:</p>
          <div className="grid gap-2">
            {f.conditions.map((c, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[10rem_10rem_minmax(0,1fr)_auto]">
                <Select aria-label="Field" value={c.field} onChange={(e) => setCond(i, { field: e.target.value, op: OPS[e.target.value]![0]![0], value: e.target.value === "category" ? "finance" : e.target.value === "hasAttachment" ? "true" : "" })}>{FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                <Select aria-label="Condition" value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>{(OPS[c.field] ?? []).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                {valueInput(c, i)}
                <IconButton label="Remove condition" icon={<Trash2 className="size-4" />} disabled={f.conditions.length === 1} onClick={() => setF({ ...f, conditions: f.conditions.filter((_, j) => j !== i) })} />
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => setF({ ...f, conditions: [...f.conditions, { field: "subject", op: "contains", value: "" }] })}>Add condition</Button>
        </div>
        <div className="rounded-[16px] border border-border p-4">
          <p className="mb-2 text-[13.5px] font-medium">Do this:</p>
          <div className="grid gap-2">
            {f.actions.map((a, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)_auto]">
                <Select aria-label="Action" value={a.type} onChange={(e) => setAct(i, { type: e.target.value, value: e.target.value === "category" ? "finance" : e.target.value === "priority" ? "high" : "" })}>{ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                {a.type === "category" ? (
                  <Select aria-label="Category" value={a.value} onChange={(e) => setAct(i, { value: e.target.value })}>{CATEGORIES.map((x) => <option key={x} value={x}>{CATEGORY_LABEL[x]}</option>)}</Select>
                ) : a.type === "priority" ? (
                  <Select aria-label="Priority" value={a.value} onChange={(e) => setAct(i, { value: e.target.value })}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></Select>
                ) : a.type === "assign" ? (
                  <Select aria-label="Assign to" value={a.value} onChange={(e) => setAct(i, { value: e.target.value })}><option value="">Choose…</option>{meta.members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}</Select>
                ) : NEEDS_VALUE.has(a.type) ? (
                  <Input aria-label="Label" value={a.value} placeholder="Label name" onChange={(e) => setAct(i, { value: e.target.value })} />
                ) : <span />}
                <IconButton label="Remove action" icon={<Trash2 className="size-4" />} disabled={f.actions.length === 1} onClick={() => setF({ ...f, actions: f.actions.filter((_, j) => j !== i) })} />
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => setF({ ...f, actions: [...f.actions, { type: "star", value: "" }] })}>Add action</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

function Templates({ meta }: { meta: MetaOut }) {
  const { orgId, call } = useMailApi();
  const toast = useToast();
  const q = useQuery({ queryKey: mailKey(orgId, "templates"), queryFn: () => call<{ templates: TemplateOut[] }>("templates") });
  const [edit, setEdit] = useState<{ id: string | null; f: { name: string; subject: string; body: string; shortcut: string; shared: boolean } } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await call(edit.id ? `templates/${edit.id}` : "templates", edit.id ? "PUT" : "POST", edit.f);
      setEdit(null);
      void q.refetch();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-muted">Reusable replies. In any message, pick one from Templates or type <Kbd>/</Kbd> and its shortcut.</p>
        <div className="flex flex-wrap gap-2">
          <ImportButton target={target("mail.templates")} onImport={(rows, mode) => call<ImportResult>("templates/import", "POST", { rows, mode })} onDone={() => void q.refetch()} />
          <ExportMenu name="email-templates" rows={q.data?.templates} columns={[{ key: "name", label: "Name" }, { key: "subject", label: "Subject" }, { key: "body", label: "Message" }, { key: "shortcut", label: "Shortcut" }]} />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ id: null, f: { name: "", subject: "", body: "Hi {{first_name}},\n\n\n\nThanks,\n{{my_name}}", shortcut: "", shared: false } })}>New template</Button>
        </div>
      </div>
      {!q.data ? <Skeleton className="h-32" /> : !q.data.templates.length ? (
        <EmptyState title="No templates yet" description="Save the replies you write again and again — prices, directions, “thanks for your order”." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {q.data.templates.map((t) => (
            <div key={t.id} className="rounded-[16px] border border-border bg-surface p-4">
              <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">{t.name}{t.shortcut && <Kbd>/{t.shortcut}</Kbd>}{t.shared && <Badge tone="accent">Team</Badge>}</p>
              <p className="mt-1 line-clamp-3 text-[12.5px] whitespace-pre-line text-muted">{t.body}</p>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[12px] text-subtle">Used {t.uses}×</span>
                {t.mine && <Button size="sm" className="ml-auto" onClick={() => setEdit({ id: t.id, f: { name: t.name, subject: t.subject, body: t.body, shortcut: t.shortcut, shared: t.shared } })}>Edit</Button>}
                {t.mine && <IconButton label={`Delete ${t.name}`} icon={<Trash2 className="size-4" />} onClick={async () => {
                  try {
                    await call(`templates/${t.id}`, "DELETE");
                    void q.refetch();
                  } catch (e) {
                    toast({ tone: "error", title: errorMessage(e) });
                  }
                }} />}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Dialog open onClose={() => setEdit(null)} size="lg" title={edit.id ? "Edit template" : "New template"} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">{(p) => <Input {...p} value={edit.f.name} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, name: e.target.value } })} />}</Field>
              <Field label="Shortcut" hint="Type /shortcut in a message">{(p) => <Input {...p} value={edit.f.shortcut} placeholder="pricing" onChange={(e) => setEdit({ ...edit, f: { ...edit.f, shortcut: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") } })} />}</Field>
            </div>
            <Field label="Subject (optional)">{(p) => <Input {...p} value={edit.f.subject} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, subject: e.target.value } })} />}</Field>
            <Field label="Message" hint="Variables: {{first_name}} {{name}} {{email}} {{company}} {{my_name}}">{(p) => <Textarea {...p} rows={9} value={edit.f.body} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, body: e.target.value } })} />}</Field>
            {meta.me.manage && <label className="flex items-center justify-between gap-3 text-[13.5px]">Share with the team <Switch label="Share with the team" checked={edit.f.shared} onChange={(v) => setEdit({ ...edit, f: { ...edit.f, shared: v } })} /></label>}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function AiInfo({ meta }: { meta: MetaOut }) {
  return (
    <div className="grid gap-4 text-[13.5px]">
      {meta.aiAvailable ? <Notice tone="success" title="AI is available">Your workspace has an AI provider connected. AI features use its monthly budget.</Notice> : <Notice tone="warning" title="No AI provider connected">Summaries, suggested replies, action extraction and the daily briefing need an AI provider. An owner can add one in <Link href="/settings" className="underline">Settings → AI providers</Link>. Everything else works without it.</Notice>}
      <ul className="grid gap-2">
        {[
          ["Always on, no AI", "Sorting into categories, the new-sender screener, priority, fake-sender warnings, rules, follow-up reminders, snooze, search."],
          ["Summarise", "A few lines on what a long conversation is about and what's being asked."],
          ["Suggest a reply", "A draft in your chosen tone that you edit before sending — nothing is sent without you."],
          ["Extract actions", "Tasks, dates, amounts and questions pulled out of a conversation."],
          ["Daily briefing", "What came in that needs you, in one short read."],
          ["Sort new mail with AI", "Optional per mailbox: AI double-checks the category of each new email."],
        ].map(([t, d]) => (
          <li key={t} className="rounded-[14px] border border-border p-3"><b className="font-medium">{t}</b><span className="block text-muted">{d}</span></li>
        ))}
      </ul>
    </div>
  );
}
