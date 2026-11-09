"use client";

// Requisitions: what clients owe you, chased by email until it's in. The list
// (what needs attention first), a new requisition (template, items, schedule,
// the mailbox it goes from, a preview of the email), one requisition (its
// checklist, files, emails both ways, and the timeline of everything that
// happened), templates, reports and settings.
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, ClipboardCheck, Copy, Download, Eye, FileText, Inbox, LayoutTemplate, Link2, MoreHorizontal, Pause, Play, Plus, RotateCcw, Send, Settings, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ShareToChatButton } from "@/components/chat/share";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { EmailButton } from "@/components/mail/compose-provider";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { ConfirmDialog, Dialog, Menu, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { composeEmail, ITEM_LABEL, LIST_LABEL, PRESETS, STARTERS, type ItemStatus, type ListStatus, type RqSettings, type Schedule } from "@/lib/requisitions/model";

type Person = { id: string; name: string; email: string };
type Mailbox = { id: string; address: string; displayName: string; status: string; shared: boolean; ownerId: string | null };
type Counts = { open: number; mine: number; drafts: number; overdue: number; review: number };
type Meta = { me: { id: string; write: boolean; manage: boolean }; settings: RqSettings; counts: Counts; mailboxes: Mailbox[]; members: Person[]; links: { crm: boolean; mail: boolean } };
type Row = { id: string; number: string; title: string; clientName: string; clientEmail: string; status: ListStatus; dueDate: string | null; overdue: boolean; dueIn: number | null; got: number; of: number; pct: number; review: number; remindersSent: number; maxReminders: number; nextReminderAt: string | null; lastSentAt: string | null; lastReplyAt: string | null; lastViewedAt: string | null; views: number; owner: string | null; ownerId: string | null; note: string; createdAt: string; completedAt: string | null; via: "mailbox" | "platform" };
type ItemRow = { id: string; title: string; description: string; required: boolean; status: ItemStatus; label: string; receivedVia: string | null; receivedAt: string | null; note: string; confidence: number | null };
type FileRow = { id: string; itemId: string | null; filename: string; mime: string; size: number; source: string; createdAt: string };
type MsgRow = { id: string; direction: "in" | "out"; kind: string; n: number; subject: string; snippet: string; fromEmail: string; mailMessageId: string | null; analysis: { summary?: string; marked?: string[]; toCheck?: string[]; promisedBy?: string | null; by?: string } | null; createdAt: string };
type EventRow = { id: string; kind: string; detail: Record<string, unknown>; createdAt: string; actor: string | null };
type Detail = { list: Row & { message: string; cc: string[]; schedule: Schedule; contactId: string | null; threadId: string | null; mailAccountId: string | null; firstViewedAt: string | null }; items: ItemRow[]; files: FileRow[]; messages: MsgRow[]; events: EventRow[]; owner: Person | null; contact: { id: string; name: string; email: string; phone: string } | null; mailbox: { id: string; address: string; status: string } | null; link: string };
type Template = { id: string; name: string; title: string; message: string; items: { title: string; description?: string; required?: boolean }[] };

const useRq = () => useModule<Meta>();
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
const dayOf = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const STATUS_TONE: Record<ListStatus, "neutral" | "warning" | "danger" | "accent" | "success"> = { draft: "neutral", active: "accent", paused: "warning", completed: "success", cancelled: "neutral" };
const ITEM_TONE: Record<ItemStatus, "neutral" | "warning" | "danger" | "accent" | "success"> = { pending: "neutral", received: "success", review: "warning", rejected: "danger", waived: "neutral" };

function dueText(r: Pick<Row, "dueIn" | "status">) {
  if (r.dueIn === null || r.status === "completed" || r.status === "cancelled") return null;
  if (r.dueIn < 0) return `${-r.dueIn} day${r.dueIn === -1 ? "" : "s"} overdue`;
  if (r.dueIn === 0) return "Due today";
  return `Due in ${r.dueIn} day${r.dueIn === 1 ? "" : "s"}`;
}

export function RequisitionsApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="requisitions"
      base="requisitions"
      title="Requisitions"
      icon={<ClipboardCheck />}
      section={section === "lists" ? "" : section}
      nav={(m) => [
        { id: "", label: "Requisitions", icon: <Inbox /> },
        { id: "templates", label: "Templates", icon: <LayoutTemplate /> },
        { id: "reports", label: "Tracking", icon: <BarChart3 /> },
        { id: "settings", label: "Settings", icon: <Settings />, hidden: !m.me.manage },
      ]}
      render={() => {
        if (section === "lists" && id === "new") return <NewList />;
        if (section === "lists" && isId(id)) return <ListView key={id} id={id!} />;
        if (section === "templates") return <Templates />;
        if (section === "reports") return <Reports />;
        if (section === "settings") return <SettingsView />;
        return <Lists />;
      }}
    />
  );
}

// ─── The list ───────────────────────────────────────────────────────────────

const VIEWS = [
  ["open", "Open"],
  ["mine", "Mine"],
  ["review", "To check"],
  ["overdue", "Overdue"],
  ["waiting", "Waiting on client"],
  ["drafts", "Drafts"],
  ["done", "Done"],
] as const;

function Progress({ pct, tone = "fg" }: { pct: number; tone?: "fg" | "success" | "warning" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-fg")} style={{ width: `${Math.max(pct ? 4 : 0, pct)}%` }} />
    </div>
  );
}

function Lists() {
  const { meta, orgId, go } = useRq();
  const qc = useQueryClient();
  const [view, setView] = useState<(typeof VIEWS)[number][0]>(meta.counts.review ? "review" : "open");
  const [q, setQ] = useState("");
  const list = useModuleQuery<{ lists: Row[] }>(`lists?${new URLSearchParams({ view, q })}`, { keepPrevious: true });
  const rows = list.data?.lists;
  const count = (v: string) => (v in meta.counts ? meta.counts[v as keyof Counts] : null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Requisitions"
        description="What clients still owe you. Reminders go out on each one's schedule until everything required is in."
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.me.write && <ImportButton target={target("requisitions.lists")} onImport={(rows, mode) => api(`/api/v1/orgs/${orgId}/requisitions/lists/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["requisitions", orgId] })} />}
            <ExportMenu name="requisitions" rows={rows} columns={[{ key: "number", label: "Number" }, { key: "title", label: "Title" }, { key: "clientName", label: "Client" }, { key: "clientEmail", label: "Email" }, { key: "status", label: "Status" }, { key: "got", label: "Received" }, { key: "of", label: "Required" }, { key: "dueDate", label: "Due" }, { key: "remindersSent", label: "Reminders sent" }, { key: "lastReplyAt", label: "Last reply" }, { key: "owner", label: "Owner" }, { key: "createdAt", label: "Created" }]} />
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("lists/new")}>New requisition</Button>}
          </div>
        }
      />
      {!meta.mailboxes.length && meta.links.mail && (
        <Notice title="Connect a mailbox so replies are read">
          Without one, requests go from Cloudesk&apos;s address and clients can upload on their link, but their email replies can&apos;t be read. <Link href="/mail" className="font-medium underline">Connect one in Mail</Link>.
        </Notice>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs value={view} onChange={setView} tabs={VIEWS.map(([v, l]) => ({ value: v, label: <span>{l}{count(v) !== null && <span className="ml-1.5 text-subtle tabular-nums">{count(v)}</span>}</span> }))} />
        <Input aria-label="Search requisitions" className="sm:!w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, title or number" />
      </div>
      {!rows ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !rows.length ? (
        <EmptyState title={view === "review" ? "Nothing to check" : view === "overdue" ? "Nothing overdue" : "No requisitions here"} description={view === "open" ? "Ask a client for what you need — reminders do the chasing." : undefined} action={meta.me.write && view === "open" ? <Button variant="primary" onClick={() => go("lists/new")}>New requisition</Button> : undefined} />
      ) : (
        <div className={cx("grid gap-2", list.isFetching && "opacity-80")}>
          {rows.map((r) => (
            <Link key={r.id} href={`/requisitions/lists/${r.id}`} className="grid gap-2 rounded-[18px] border border-border bg-surface p-4 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_200px_170px] sm:items-center sm:gap-5">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[14px] font-semibold">{r.title}</span>
                  <Badge tone={STATUS_TONE[r.status]}>{LIST_LABEL[r.status]}</Badge>
                  {r.review > 0 && <Badge tone="warning">{r.review} to check</Badge>}
                  {r.overdue && <Badge tone="danger">Overdue</Badge>}
                </span>
                <span className="block truncate text-[12.5px] text-muted">
                  {r.number} · {r.clientName || r.clientEmail}
                  {r.owner ? ` · ${r.owner}` : ""}
                </span>
              </span>
              <span className="grid gap-1">
                <span className="flex justify-between text-[12px] tabular-nums">
                  <span className="text-muted">{r.got} of {r.of} received</span>
                  <span className="font-medium">{r.pct}%</span>
                </span>
                <Progress pct={r.pct} tone={r.pct === 100 ? "success" : r.overdue ? "warning" : "fg"} />
              </span>
              <span className="text-[12px] text-muted sm:text-right">
                {r.status === "active" && r.nextReminderAt ? <>Next reminder {when(r.nextReminderAt)}</> : r.note ? <span className="text-warning">{r.note}</span> : r.completedAt ? <>Completed {when(r.completedAt)}</> : null}
                <span className="block">
                  {dueText(r) ?? ""}
                  {dueText(r) && (r.remindersSent || r.lastReplyAt) ? " · " : ""}
                  {r.lastReplyAt ? `Replied ${when(r.lastReplyAt)}` : r.remindersSent ? `${r.remindersSent} reminder${r.remindersSent === 1 ? "" : "s"}` : ""}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── A new requisition ──────────────────────────────────────────────────────

type DraftItem = { title: string; description: string; required: boolean };

function ScheduleFields({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const preset = PRESETS.find((p) => JSON.stringify(p.schedule) === JSON.stringify(value))?.id ?? "custom";
  const [custom, setCustom] = useState(preset === "custom");
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => (onChange(p.schedule), setCustom(false))} className={cx("rounded-[14px] border px-3 py-2.5 text-left transition-colors", preset === p.id && !custom ? "border-fg bg-surface-2" : "border-border hover:bg-surface-2")}>
            <span className="block text-[13px] font-medium">{p.label}</span>
            <span className="block text-[11.5px] text-muted">{p.sub}</span>
          </button>
        ))}
        <button type="button" onClick={() => setCustom(true)} className={cx("rounded-[14px] border px-3 py-2.5 text-left transition-colors", custom || preset === "custom" ? "border-fg bg-surface-2" : "border-border hover:bg-surface-2")}>
          <span className="block text-[13px] font-medium">Your own</span>
          <span className="block text-[11.5px] text-muted">Choose every detail</span>
        </button>
      </div>
      {(custom || preset === "custom") && (
        <div className="grid gap-3 rounded-[14px] bg-surface-2 p-3 sm:grid-cols-3">
          <Field label="Every (days)">{(a) => <Input {...a} type="number" min={1} max={30} value={value.everyDays} onChange={(e) => onChange({ ...value, everyDays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />}</Field>
          <Field label="At (India time)">{(a) => <Input {...a} type="time" value={value.at} onChange={(e) => onChange({ ...value, at: e.target.value || "10:30" })} />}</Field>
          <Field label="Stop after (reminders)">{(a) => <Input {...a} type="number" min={1} max={30} value={value.maxReminders} onChange={(e) => onChange({ ...value, maxReminders: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />}</Field>
          <Field label="After a reply, wait (days)">{(a) => <Input {...a} type="number" min={0} max={14} value={value.quietAfterReply} onChange={(e) => onChange({ ...value, quietAfterReply: Math.max(0, Math.min(14, Number(e.target.value) || 0)) })} />}</Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><Switch checked={value.weekdaysOnly} onChange={(v) => onChange({ ...value, weekdaysOnly: v })} label="Weekdays only" /> Weekdays only</label>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><Switch checked={value.escalate} onChange={(v) => onChange({ ...value, escalate: v })} label="Firmer as they go" /> Firmer as they go</label>
        </div>
      )}
    </div>
  );
}

function ItemsEditor({ items, onChange }: { items: DraftItem[]; onChange: (x: DraftItem[]) => void }) {
  const set = (i: number, p: Partial<DraftItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="grid gap-2">
      {items.map((it, i) => (
        <div key={i} className="grid gap-2 rounded-[14px] border border-border p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto_auto] sm:items-center">
          <Input aria-label={`Item ${i + 1}`} placeholder="What you need, e.g. PAN card" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
          <Input aria-label={`Item ${i + 1} details`} placeholder="Details for the client (optional)" value={it.description} onChange={(e) => set(i, { description: e.target.value })} />
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted"><Switch checked={it.required} onChange={(v) => set(i, { required: v })} label="Required" /> Required</label>
          <IconButton label="Remove item" onClick={() => onChange(items.filter((_, j) => j !== i))} disabled={items.length === 1}><X className="size-4" /></IconButton>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => onChange([...items, { title: "", description: "", required: true }])}>Add an item</Button>
    </div>
  );
}

function ClientPicker({ onPick }: { onPick: (c: { id: string; name: string; email: string }) => void }) {
  const { orgId } = useRq();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; email: string }[]>([]);
  const search = async (v: string) => {
    setQ(v);
    if (v.trim().length < 2) return setHits([]);
    const r = await api<{ contacts: { id: string; name: string; email: string }[] }>(`/api/v1/orgs/${orgId}/crm/search?q=${encodeURIComponent(v.trim())}`).catch(() => ({ contacts: [] }));
    setHits(r.contacts.filter((c) => c.email));
  };
  return (
    <div className="relative">
      <Input aria-label="Find a CRM contact" placeholder="Find a contact in your CRM" value={q} onChange={(e) => void search(e.target.value)} />
      {hits.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-[14px] border border-border bg-[var(--surface-solid)] p-1 shadow-lg">
          {hits.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full rounded-[10px] px-3 py-2 text-left text-[13px] hover:bg-surface-2" onClick={() => (onPick(c), setHits([]), setQ(c.name))}>
                <span className="font-medium">{c.name}</span> <span className="text-muted">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewList() {
  const { meta, go } = useRq();
  const tpl = useModuleQuery<{ templates: Template[]; starters: typeof STARTERS }>("templates");
  const [f, setF] = useState({ title: "", message: "", clientName: "", clientEmail: "", cc: "", contactId: null as string | null, dueDate: "", mailAccountId: meta.settings.mailAccountId ?? "", ownerId: meta.me.id });
  const [items, setItems] = useState<DraftItem[]>([{ title: "", description: "", required: true }]);
  const [schedule, setSchedule] = useState<Schedule>(meta.settings.schedule);
  const [preview, setPreview] = useState(false);
  const use = (t: { title?: string; name?: string; message?: string; items: { title: string; description?: string; required?: boolean }[] }) => {
    setF((x) => ({ ...x, title: x.title || t.title || t.name || "", message: x.message || t.message || "" }));
    setItems(t.items.map((i) => ({ title: i.title, description: i.description ?? "", required: i.required ?? true })));
  };
  const clean = items.filter((i) => i.title.trim());
  const cc = f.cc.split(/[,\s;]+/).map((x) => x.trim()).filter(Boolean);
  const body = (send: boolean) => ({ ...f, cc, contactId: f.contactId, dueDate: f.dueDate || null, mailAccountId: f.mailAccountId || null, items: clean, schedule, send });
  const save = useModuleAction<boolean, { list: { id: string } }>((send) => ({ path: "lists", body: body(send) }), { success: (r) => (r ? "Requisition saved" : "Saved"), onDone: (r) => go(`lists/${r.list.id}`) });
  const ok = f.title.trim() && /\S+@\S+\.\S+/.test(f.clientEmail) && clean.length > 0;
  const email = composeEmail({ kind: "request", n: 0, max: schedule.maxReminders, escalate: schedule.escalate, business: "Your business", number: "REQ-0000", title: f.title || "Your request", message: f.message, clientName: f.clientName, dueDate: f.dueDate || null, items: clean.map((i) => ({ ...i, status: "pending", note: "" })), link: "https://cloudesk.in/collect/…", signOff: meta.settings.signOff, sender: "" });
  const templates = [...(tpl.data?.templates ?? []), ...(tpl.data?.starters ?? STARTERS).map((s, i) => ({ ...s, id: `starter-${i}`, message: "" }))];
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="New requisition" description="List what you need; the request goes now and reminders follow on the schedule until it's all in." />
      <Card className="grid gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-medium text-muted">Start from</span>
          {templates.slice(0, 8).map((t) => (
            <button key={t.id} type="button" onClick={() => use(t)} className="rounded-full border border-border px-3 py-1 text-[12.5px] hover:bg-surface-2">
              {t.name}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {meta.links.crm && (
            <Field label="Client from your CRM" className="sm:col-span-2" hint="Or type their name and email below">
              {() => <ClientPicker onPick={(c) => setF((x) => ({ ...x, contactId: c.id, clientName: c.name, clientEmail: c.email }))} />}
            </Field>
          )}
          <Field label="Client name">{(a) => <Input {...a} value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} />}</Field>
          <Field label="Client email">{(a) => <Input {...a} type="email" value={f.clientEmail} onChange={(e) => setF({ ...f, clientEmail: e.target.value, contactId: null })} />}</Field>
          <Field label="Copy to" hint="Other emails, separated by commas">{(a) => <Input {...a} value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} />}</Field>
          <Field label="Due by">{(a) => <Input {...a} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
          <Field label="Title" className="sm:col-span-2" hint="What it's for — the client sees this">{(a) => <Input {...a} maxLength={200} value={f.title} placeholder="e.g. Documents for your FY 2025–26 tax return" onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Message" className="sm:col-span-2" hint="Optional — opens the first email">{(a) => <Textarea {...a} rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
        </div>
      </Card>
      <Card className="grid gap-3 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold">What you need</h2>
        <ItemsEditor items={items} onChange={setItems} />
      </Card>
      <Card className="grid gap-3 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold">Reminders</h2>
        <ScheduleFields value={schedule} onChange={setSchedule} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Send from" hint={f.mailAccountId ? "Replies come back here and are read" : "Cloudesk's address — replies go to the owner's email and aren't read"}>
            {(a) => (
              <Select {...a} value={f.mailAccountId} onChange={(e) => setF({ ...f, mailAccountId: e.target.value })}>
                <option value="">Cloudesk&apos;s address</option>
                {meta.mailboxes.map((m) => <option key={m.id} value={m.id}>{m.displayName ? `${m.displayName} <${m.address}>` : m.address}{m.status !== "active" ? ` (${m.status})` : ""}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Owner" hint="Hears about replies and uploads">
            {(a) => <Select {...a} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{meta.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}
          </Field>
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => go("")}>Cancel</Button>
        <Button icon={<Eye className="size-3.5" />} disabled={!clean.length} onClick={() => setPreview(true)}>Preview email</Button>
        <Button loading={save.isPending && save.variables === false} disabled={!ok} onClick={() => save.mutate(false)}>Save as draft</Button>
        <Button variant="primary" icon={<Send className="size-3.5" />} loading={save.isPending && save.variables === true} disabled={!ok} onClick={() => save.mutate(true)}>Send request</Button>
      </div>
      {preview && (
        <Dialog open onClose={() => setPreview(false)} title={email.subject} description="The first email, as the client will see it (your business name and the real link fill in).">
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-[14px] bg-surface-2 p-4 font-sans text-[13px] leading-relaxed">{email.body}</pre>
        </Dialog>
      )}
    </div>
  );
}

// ─── One requisition ────────────────────────────────────────────────────────

const EVENT_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  created: (d) => `Created with ${d.items} item${d.items === 1 ? "" : "s"}`,
  requested: (d) => `Request sent to ${(d.to as string[] | undefined)?.join(", ") ?? "the client"}${d.via === "platform" ? " (from Cloudesk's address)" : ""}`,
  reminded: (d) => `Reminder ${d.n} sent`,
  failed: (d) => `Couldn't send${d.n ? ` reminder ${d.n}` : ""}: ${d.note}`,
  viewed: (d) => (d.first ? "The client opened their link for the first time" : "The client opened their link"),
  uploaded: (d) => `The client uploaded ${d.filename}${d.item ? ` for ${d.item}` : ""}`,
  replied: (d) => `The client replied${d.summary ? `: ${d.summary}` : ""}${(d.marked as string[] | undefined)?.length ? ` — received ${(d.marked as string[]).join(", ")}` : ""}${(d.toCheck as string[] | undefined)?.length ? ` — to check ${(d.toCheck as string[]).join(", ")}` : ""}${d.promisedBy ? ` — promised by ${d.promisedBy}` : ""}`,
  client_note: (d) => `The client left a note: “${d.text}”`,
  item_received: (d) => `Marked ${d.item} received`,
  item_review: (d) => `Set ${d.item} to check`,
  item_rejected: (d) => `Sent ${d.item} back: ${d.note}`,
  item_waived: (d) => `${d.item} isn't needed`,
  item_pending: (d) => `${d.item} back to waiting`,
  item_added: (d) => `Added ${d.title}`,
  item_removed: (d) => `Removed ${d.title}`,
  paused: (d) => (d.reason === "do_not_contact" ? "Paused: the contact asked not to be contacted" : "Paused"),
  resumed: () => "Resumed",
  cancelled: () => "Cancelled",
  completed: (d) => (d.manual ? "Marked complete" : "Everything required is in"),
  thanked: () => "Thank-you sent to the client",
  reopened: () => "Reopened",
  link_rotated: () => "A new client link was made; the old one stopped working",
  edited: () => "Details changed",
};

function ListView({ id }: { id: string }) {
  const { meta, orgId, go } = useRq();
  const toast = useToast();
  const q = useModuleQuery<Detail>(`lists/${id}`);
  const act = useModuleAction<string, Detail>((what) => ({ path: `lists/${id}/${what}` }), { success: (r) => (r.list.status === "completed" ? "Complete" : "Done") });
  const item = useModuleAction<{ itemId: string; status?: ItemStatus; note?: string }, Detail>(({ itemId, ...b }) => ({ path: `lists/${id}/items/${itemId}`, method: "PATCH", body: b }));
  const assign = useModuleAction<{ fileId: string; itemId: string | null }, Detail>(({ fileId, itemId }) => ({ path: `lists/${id}/files/${fileId}`, method: "PATCH", body: { itemId } }), { success: "Filed" });
  const del = useModuleAction<void, unknown>(() => ({ path: `lists/${id}`, method: "DELETE" }), { success: "Deleted", onDone: () => go("") });
  const [back, setBack] = useState<ItemRow | null>(null);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [tab, setTab] = useState<"timeline" | "emails" | "files">("timeline");
  if (!q.data) return <Skeleton className="h-96 rounded-[20px]" />;
  const d = q.data;
  const l = d.list;
  const w = meta.me.write;
  const fileUrl = (f: FileRow) => `/api/v1/orgs/${orgId}/requisitions/lists/${id}/files/${f.id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.link);
      toast({ tone: "success", title: "Client link copied" });
    } catch {
      toast({ tone: "info", title: d.link });
    }
  };
  const open = l.status === "active" || l.status === "paused" || l.status === "draft";
  return (
    <div className="space-y-4">
      <PageHeader
        title={l.title}
        description={`${l.number} · ${l.clientName ? `${l.clientName} · ` : ""}${l.clientEmail}${l.cc.length ? ` (+${l.cc.length} copied)` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {w && open && (
              <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} loading={act.isPending && act.variables === "send"} onClick={() => act.mutate("send")}>
                {l.lastSentAt ? "Send a reminder now" : "Send request"}
              </Button>
            )}
            {w && l.status === "active" && <Button size="sm" icon={<Pause className="size-3.5" />} onClick={() => act.mutate("pause")}>Pause</Button>}
            {w && l.status === "paused" && <Button size="sm" icon={<Play className="size-3.5" />} onClick={() => act.mutate("resume")}>Resume</Button>}
            <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => void copy()}>Client link</Button>
            <EmailButton to={[{ email: l.clientEmail, name: l.clientName }]} subject={`Re: ${l.title} [${l.number}]`} />
            <ShareToChatButton card={{ kind: "requisitions", id: l.id, title: l.title, sub: `${l.clientName || l.clientEmail} · ${l.got}/${l.of} received`, link: `/requisitions/lists/${l.id}`, module: "Requisition", fields: [{ label: "Status", value: LIST_LABEL[l.status] }, { label: "Due", value: dayOf(l.dueDate) }] }} />
            {w && (
              <Menu
                label="More"
                trigger={(p) => <IconButton {...p} label="More"><MoreHorizontal className="size-4" /></IconButton>}
                items={[
                  ...(open ? [{ label: "Mark complete", icon: <Check className="size-4" />, onSelect: () => act.mutate("complete") }] : []),
                  ...(l.status === "completed" || l.status === "cancelled" ? [{ label: "Reopen", icon: <Undo2 className="size-4" />, onSelect: () => act.mutate("reopen") }] : []),
                  { label: "New client link (stops the old one)", icon: <RotateCcw className="size-4" />, onSelect: () => act.mutate("rotate") },
                  ...(open ? [{ label: "Cancel requisition", icon: <X className="size-4" />, onSelect: () => act.mutate("cancel"), danger: true }] : []),
                  "separator" as const,
                  { label: "Delete", icon: <Trash2 className="size-4" />, onSelect: () => setConfirmDel(true), danger: true },
                ]}
              />
            )}
          </div>
        }
      />
      {l.note && <Notice tone="warning">{l.note}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-4">
          <Card className="overflow-hidden">
            <div className="grid gap-2 border-b border-border p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Badge tone={STATUS_TONE[l.status]}>{LIST_LABEL[l.status]}</Badge>{l.overdue && <Badge tone="danger">Overdue</Badge>}</span>
                <span className="text-[13px] tabular-nums"><b className="font-semibold">{l.got}</b> of {l.of} required received · {l.pct}%</span>
              </div>
              <Progress pct={l.pct} tone={l.pct === 100 ? "success" : l.overdue ? "warning" : "fg"} />
            </div>
            <ul className="divide-y divide-border">
              {d.items.map((it) => {
                const files = d.files.filter((f) => f.itemId === it.id);
                return (
                  <li key={it.id} className="grid gap-2 px-4 py-3 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                          {it.title}
                          {!it.required && <span className="text-[11.5px] font-normal text-subtle">optional</span>}
                        </p>
                        {it.description && <p className="text-[12.5px] text-muted">{it.description}</p>}
                        {(it.note || it.receivedAt) && (
                          <p className={cx("text-[12px]", it.status === "rejected" ? "text-danger" : "text-subtle")}>
                            {it.status === "rejected" ? `Sent back: ${it.note}` : `${it.receivedVia === "email" ? "From their reply" : it.receivedVia === "upload" ? "Uploaded" : "Marked"} ${when(it.receivedAt)}${it.note ? ` — ${it.note}` : ""}${it.confidence !== null && it.confidence !== undefined ? ` (${Math.round(it.confidence * 100)}% sure)` : ""}`}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge tone={ITEM_TONE[it.status]}>{ITEM_LABEL[it.status]}</Badge>
                        {w && (
                          <Menu
                            label={`Change ${it.title}`}
                            trigger={(p) => <IconButton {...p} label={`Change ${it.title}`}><MoreHorizontal className="size-4" /></IconButton>}
                            items={[
                              ...(it.status !== "received" ? [{ label: it.status === "review" ? "Looks right — received" : "Mark received", icon: <Check className="size-4" />, onSelect: () => item.mutate({ itemId: it.id, status: "received" }) }] : []),
                              ...(it.status === "received" || it.status === "review" ? [{ label: "Not right — ask again", icon: <Undo2 className="size-4" />, onSelect: () => (setBack(it), setNote("")) }] : []),
                              ...(it.status !== "waived" ? [{ label: "Not needed", icon: <X className="size-4" />, onSelect: () => item.mutate({ itemId: it.id, status: "waived" }) }] : []),
                              ...(it.status !== "pending" ? [{ label: "Back to waiting", icon: <RotateCcw className="size-4" />, onSelect: () => item.mutate({ itemId: it.id, status: "pending" }) }] : []),
                            ]}
                          />
                        )}
                      </div>
                    </div>
                    {files.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {files.map((f) => (
                          <a key={f.id} href={fileUrl(f)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] hover:bg-surface-3">
                            <FileText className="size-3.5 shrink-0" /> <span className="truncate">{f.filename}</span> <span className="text-subtle">{size(f.size)}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {w && (
              <div className="border-t border-border px-4 py-2.5 sm:px-5">
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Ask for something else</Button>
              </div>
            )}
          </Card>
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 pt-2 sm:px-5">
              <Tabs value={tab} onChange={setTab} tabs={[{ value: "timeline", label: "Timeline" }, { value: "emails", label: `Emails ${d.messages.length ? d.messages.length : ""}` }, { value: "files", label: `Files ${d.files.length ? d.files.length : ""}` }]} />
            </div>
            {tab === "timeline" && (
              <ol className="grid gap-0 p-4 sm:p-5">
                {d.events.map((e, i) => (
                  <li key={e.id} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 pb-3 last:pb-0">
                    {i < d.events.length - 1 && <span aria-hidden className="absolute top-3 bottom-0 left-[7px] w-px bg-border" />}
                    <span aria-hidden className={cx("relative mt-1.5 size-2 justify-self-center rounded-full ring-4 ring-surface", ["replied", "uploaded", "completed", "item_received"].includes(e.kind) ? "bg-success" : e.kind === "failed" || e.kind === "item_rejected" ? "bg-danger" : e.kind === "viewed" ? "bg-accent" : "bg-subtle")} />
                    <div className="min-w-0">
                      <p className="text-[13px]">{(EVENT_TEXT[e.kind] ?? (() => e.kind.replace(/_/g, " ")))(e.detail)}</p>
                      <p className="text-[11.5px] text-subtle">{when(e.createdAt)}{e.actor ? ` · ${e.actor}` : ""}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {tab === "emails" && (
              <ul className="divide-y divide-border">
                {!d.messages.length && <li className="px-5 py-8 text-center text-[13px] text-muted">No emails yet.</li>}
                {d.messages.map((m) => (
                  <li key={m.id} className="grid gap-1 px-4 py-3 sm:px-5">
                    <p className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <Badge tone={m.direction === "in" ? "success" : "neutral"}>{m.direction === "in" ? (m.kind === "note" ? "Client note" : "Client reply") : m.kind === "request" ? "Request" : m.kind === "thanks" ? "Thank-you" : `Reminder ${m.n}`}</Badge>
                      <span className="text-subtle">{when(m.createdAt)}</span>
                      {m.mailMessageId && meta.links.mail && <Link href={`/mail/t/${l.threadId ?? ""}`} className="text-accent hover:underline">Open in Mail</Link>}
                    </p>
                    <p className="text-[13px] font-medium">{m.subject}</p>
                    <p className="line-clamp-2 text-[12.5px] text-muted">{m.analysis?.summary || m.snippet}</p>
                    {m.analysis && (m.analysis.marked?.length || m.analysis.toCheck?.length) ? <p className="text-[12px] text-success">{[m.analysis.marked?.length ? `Received: ${m.analysis.marked.join(", ")}` : "", m.analysis.toCheck?.length ? `To check: ${m.analysis.toCheck.join(", ")}` : ""].filter(Boolean).join(" · ")}{m.analysis.by === "ai" ? " · read by AI" : m.analysis.by === "names" ? " · matched by file name" : ""}</p> : null}
                  </li>
                ))}
              </ul>
            )}
            {tab === "files" && (
              <ul className="divide-y divide-border">
                {!d.files.length && <li className="px-5 py-8 text-center text-[13px] text-muted">Nothing received yet.</li>}
                {d.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
                    <FileText className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{f.filename}</span>
                      <span className="block text-[11.5px] text-subtle">{size(f.size)} · {f.source === "email" ? "From a reply" : "Uploaded"} · {when(f.createdAt)}</span>
                    </span>
                    {w && (
                      <Select aria-label={`File ${f.filename} as`} className="!h-8 !w-44 !text-[12.5px]" value={f.itemId ?? ""} onChange={(e) => assign.mutate({ fileId: f.id, itemId: e.target.value || null })}>
                        <option value="">Not filed</option>
                        {d.items.map((it) => <option key={it.id} value={it.id}>{it.title}</option>)}
                      </Select>
                    )}
                    <a href={fileUrl(f)} className="inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline" download={f.filename}><Download className="size-3.5" /> Download</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card className="grid gap-2.5 p-4 text-[13px]">
            <h2 className="text-[13px] font-semibold">Chasing</h2>
            <Info label="Due">{dayOf(l.dueDate)}{dueText(l) ? ` · ${dueText(l)}` : ""}</Info>
            <Info label="Next reminder">{l.status === "active" && l.nextReminderAt ? when(l.nextReminderAt) : l.status === "active" ? "None planned" : "—"}</Info>
            <Info label="Reminders sent">{l.remindersSent} of {l.maxReminders}</Info>
            <Info label="Schedule">Every {l.schedule.everyDays} day{l.schedule.everyDays === 1 ? "" : "s"} at {l.schedule.at}{l.schedule.weekdaysOnly ? ", weekdays" : ""}</Info>
            <Info label="Sent from">{d.mailbox ? d.mailbox.address : "Cloudesk's address (replies aren't read)"}</Info>
            <Info label="Last reply">{when(l.lastReplyAt)}</Info>
            <Info label="Link opened">{l.views ? `${l.views} time${l.views === 1 ? "" : "s"} · last ${when(l.lastViewedAt)}` : "Not yet"}</Info>
            <Info label="Owner">{d.owner?.name ?? "—"}</Info>
            {d.contact && <Info label="CRM contact"><Link href={`/crm/contacts/${d.contact.id}`} className="text-accent hover:underline">{d.contact.name}</Link></Info>}
          </Card>
          <Card className="grid gap-2 p-4 text-[13px]">
            <h2 className="text-[13px] font-semibold">The client&apos;s link</h2>
            <p className="text-[12.5px] text-muted">In every email. They see what&apos;s still needed and upload each file against its item — no sign-in.</p>
            <div className="flex gap-2">
              <Input readOnly aria-label="Client link" value={d.link} onFocus={(e) => e.currentTarget.select()} className="!text-[12px]" />
              <IconButton label="Copy link" onClick={() => void copy()}><Copy className="size-4" /></IconButton>
            </div>
          </Card>
        </div>
      </div>
      {back && (
        <Dialog
          open
          onClose={() => setBack(null)}
          size="sm"
          title={`Ask again for ${back.title}`}
          description="The client sees your note in the next reminder and on their link."
          footer={<><Button onClick={() => setBack(null)}>Cancel</Button><Button variant="primary" disabled={!note.trim()} loading={item.isPending} onClick={() => item.mutate({ itemId: back.id, status: "rejected", note: note.trim() }, { onSuccess: () => setBack(null) })}>Ask again</Button></>}
        >
          <Textarea aria-label="What's wrong" rows={3} value={note} placeholder="e.g. The statement is cut off — please send all pages" onChange={(e) => setNote(e.target.value)} />
        </Dialog>
      )}
      {adding && <AddItem id={id} onClose={() => setAdding(false)} />}
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={() => (setConfirmDel(false), del.mutate())} destructive title={`Delete ${l.number}?`} confirmLabel="Delete" description="Its items, files and history go too. Reminders stop. This can't be undone." />
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function AddItem({ id, onClose }: { id: string; onClose: () => void }) {
  const [f, setF] = useState({ title: "", description: "", required: true });
  const save = useModuleAction<void, Detail>(() => ({ path: `lists/${id}/items`, body: f }), { success: "Added — it's in the next reminder", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="sm" title="Ask for something else" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Add</Button></>}>
      <div className="grid gap-3">
        <Field label="What you need">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Details for the client">{(a) => <Input {...a} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.required} onChange={(v) => setF({ ...f, required: v })} label="Required" /> Required</label>
      </div>
    </Dialog>
  );
}

// ─── Templates ──────────────────────────────────────────────────────────────

function Templates() {
  const { meta } = useRq();
  const q = useModuleQuery<{ templates: Template[]; starters: typeof STARTERS }>("templates");
  const [edit, setEdit] = useState<Template | "new" | null>(null);
  const del = useModuleAction<string, unknown>((tid) => ({ path: `templates/${tid}`, method: "DELETE" }), { success: "Deleted" });
  return (
    <div className="space-y-4">
      <PageHeader title="Templates" description="Lists you ask for often, ready to start a requisition from." actions={meta.me.write ? <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit("new")}>New template</Button> : undefined} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {q.data.templates.map((t) => (
              <Card key={t.id} className="grid gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold">{t.name}</p>
                  {meta.me.write && <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Edit</Button><IconButton label="Delete template" onClick={() => del.mutate(t.id)}><Trash2 className="size-4" /></IconButton></span>}
                </div>
                <p className="text-[12.5px] text-muted">{t.items.map((i) => i.title).join(" · ")}</p>
              </Card>
            ))}
          </div>
          <div>
            <h2 className="mb-2 text-[13px] font-semibold text-muted">Ready-made</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {q.data.starters.map((t) => (
                <Card key={t.name} className="grid gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold">{t.name}</p>
                    {meta.me.write && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: "", name: t.name, title: t.title, message: "", items: t.items })}>Copy and edit</Button>}
                  </div>
                  <p className="text-[12.5px] text-muted">{t.items.map((i) => i.title).join(" · ")}</p>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
      {edit && <TemplateEditor t={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TemplateEditor({ t, onClose }: { t: Template | null; onClose: () => void }) {
  const [f, setF] = useState({ name: t?.name ?? "", title: t?.title ?? "", message: t?.message ?? "" });
  const [items, setItems] = useState<DraftItem[]>(t?.items.map((i) => ({ title: i.title, description: i.description ?? "", required: i.required ?? true })) ?? [{ title: "", description: "", required: true }]);
  const save = useModuleAction<void, unknown>(() => ({ path: t?.id ? `templates/${t.id}` : "templates", method: t?.id ? "PUT" : "POST", body: { ...f, items: items.filter((i) => i.title.trim()) } }), { success: "Template saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={t?.id ? "Edit template" : "New template"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim() || !items.some((i) => i.title.trim())} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Title the client sees">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        </div>
        <Field label="Message">{(a) => <Textarea {...a} rows={2} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
        <ItemsEditor items={items} onChange={setItems} />
      </div>
    </Dialog>
  );
}

// ─── Tracking ───────────────────────────────────────────────────────────────

type Report = { open: number; overdue: number; done30: number; done: number; avgDays: number; avgReminders: number; engagedRate: number; viewedRate: number; remindersSent: number; receivedBy: Record<string, number>; slowest: { id: string; number: string; title: string; clientName: string; clientEmail: string; remindersSent: number; dueDate: string | null; createdAt: string }[] };

function Reports() {
  const q = useModuleQuery<Report>("reports");
  const r = q.data;
  const tiles = useMemo(
    () =>
      r
        ? [
            ["Open now", r.open, ""],
            ["Overdue", r.overdue, ""],
            ["Completed in 30 days", r.done30, ""],
            ["Average days to complete", r.avgDays, "days"],
            ["Reminders before complete", r.avgReminders, "on average"],
            ["Clients who engaged", `${r.engagedRate}%`, "replied or opened their link"],
            ["Opened their link", `${r.viewedRate}%`, ""],
            ["Reminders sent", r.remindersSent, "in all"],
          ]
        : [],
    [r],
  );
  if (!r) return <Skeleton className="h-60 rounded-[20px]" />;
  const by = r.receivedBy;
  const total = Object.values(by).reduce((n, x) => n + x, 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Tracking" description="How chasing is going: what's open and late, how fast clients finish, and how items come in." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, sub]) => (
          <Card key={String(label)} className="grid gap-1 p-4">
            <p className="text-[12px] font-medium text-muted">{label}</p>
            <p className="text-[22px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
            {sub && <p className="text-[11.5px] text-subtle">{sub}</p>}
          </Card>
        ))}
      </div>
      <Card className="grid gap-3 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold">How items arrive</h2>
        {total === 0 ? <p className="text-[13px] text-muted">Nothing received yet.</p> : (
          <div className="grid gap-2">
            {(["upload", "email", "manual"] as const).map((k) => (
              <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)_48px] items-center gap-3 text-[13px]">
                <span className="text-muted">{k === "upload" ? "Client's link" : k === "email" ? "Email replies" : "Marked by team"}</span>
                <Progress pct={Math.round(((by[k] ?? 0) / total) * 100)} />
                <span className="text-right tabular-nums">{by[k] ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <h2 className="border-b border-border px-4 py-3 text-[14px] font-semibold sm:px-5">Needing the most chasing</h2>
        {!r.slowest.length ? <p className="px-5 py-6 text-[13px] text-muted">Nothing open.</p> : (
          <ul className="divide-y divide-border">
            {r.slowest.map((x) => (
              <li key={x.id}>
                <Link href={`/requisitions/lists/${x.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px] hover:bg-surface-2 sm:px-5">
                  <span className="min-w-0"><span className="font-medium">{x.title}</span> <span className="text-muted">· {x.clientName || x.clientEmail} · {x.number}</span></span>
                  <span className="text-muted tabular-nums">{x.remindersSent} reminder{x.remindersSent === 1 ? "" : "s"}{x.dueDate ? ` · due ${dayOf(x.dueDate)}` : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

function SettingsView() {
  const { meta } = useRq();
  const [v, setV] = useState<RqSettings>(meta.settings);
  const save = useModuleAction<void, unknown>(() => ({ path: "settings", method: "PUT", body: v }), { success: "Settings saved" });
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" description="Where requests go from, the usual schedule, and how replies are read." />
      <Card className="grid gap-4 p-4 sm:p-5">
        <Field label="Send from" hint={v.mailAccountId ? "Requests and reminders go from this mailbox, in one conversation; replies are read as it syncs" : "Cloudesk's address — replies go to the owner's own email and aren't read"}>
          {(a) => (
            <Select {...a} value={v.mailAccountId ?? ""} onChange={(e) => setV({ ...v, mailAccountId: e.target.value || null })}>
              <option value="">Cloudesk&apos;s address</option>
              {meta.mailboxes.map((m) => <option key={m.id} value={m.id}>{m.displayName ? `${m.displayName} <${m.address}>` : m.address}</option>)}
            </Select>
          )}
        </Field>
        <div>
          <p className="mb-2 text-[13px] font-medium">Usual reminder schedule</p>
          <ScheduleFields value={v.schedule} onChange={(schedule) => setV({ ...v, schedule })} />
        </div>
        <Field label="Sign-off" hint="Closes every email, before the owner's name">{(a) => <Textarea {...a} rows={2} value={v.signOff} placeholder="Thank you," onChange={(e) => setV({ ...v, signOff: e.target.value })} />}</Field>
        <label className="flex items-start gap-3 text-[13px]"><Switch checked={v.readReplies} onChange={(x) => setV({ ...v, readReplies: x })} label="Read replies with AI" /> <span><b className="font-medium">Read replies with AI</b><span className="block text-muted">Works out which items a reply delivers, which attachment is which, and dates they promise. Uses your plan&apos;s AI allowance; when off, attachments are matched by file name.</span></span></label>
        <Field label={`Mark received when at least ${Math.round(v.autoMark * 100)}% sure`} hint="Less sure matches are marked “Check this” for the team">{(a) => <input {...a} type="range" min={50} max={99} value={Math.round(v.autoMark * 100)} onChange={(e) => setV({ ...v, autoMark: Number(e.target.value) / 100 })} className="w-full accent-[var(--fg)]" />}</Field>
        <label className="flex items-start gap-3 text-[13px]"><Switch checked={v.trustUploads} onChange={(x) => setV({ ...v, trustUploads: x })} label="Trust uploads" /> <span><b className="font-medium">Uploads count as received</b><span className="block text-muted">A file the client uploads against an item marks it received. Off: it waits for the team to check.</span></span></label>
        <label className="flex items-start gap-3 text-[13px]"><Switch checked={v.thankYou} onChange={(x) => setV({ ...v, thankYou: x })} label="Thank the client" /> <span><b className="font-medium">Thank the client when everything&apos;s in</b><span className="block text-muted">A short email, in the same conversation.</span></span></label>
      </Card>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
    </div>
  );
}
