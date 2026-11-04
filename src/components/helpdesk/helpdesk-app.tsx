"use client";

// Helpdesk: the ticket inbox (views, search, due times), a ticket (the
// conversation, reply or internal note, saved replies, status, priority and
// owner, the customer and their other tickets), saved replies, reports, and
// settings (hours, targets, assignment, the inbound email address).
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Copy, Inbox, LifeBuoy, MessageSquareText, Plus, RefreshCw, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { ConfirmDialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Field, IconButton, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx, FormLines } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { CHANNELS, PRIORITIES, STATUSES, STATUS_LABEL, type HdSettings, type Status } from "@/lib/helpdesk/model";
import { target } from "@/lib/import/targets";
import { CustomFieldsCard } from "@/components/custom/fields-card";

type Agent = { id: string; name: string; email: string };
type Counts = { open: number; mine: number; unassigned: number; waiting: number; breached: number };
type Meta = { me: { id: string; write: boolean; manage: boolean }; settings: HdSettings; agents: Agent[]; counts: Counts; links: { crm: boolean } };
type Row = { id: string; number: string; subject: string; status: Status; priority: string; channel: string; customerName: string; customerEmail: string; assignee: string | null; assigneeId: string | null; tags: string[]; createdAt: string; updatedAt: string; nextDue: string | null; dueKind: "first" | "resolve"; overdue: boolean; breached: boolean; csat: number | null };
type Msg = { id: string; kind: "customer" | "reply" | "note" | "event"; body: string; author: string | null; fromName: string; fromEmail: string; createdAt: string };
type Detail = { ticket: Row & { customerPhone: string; firstResponseDue: string | null; resolveDue: string | null; firstRespondedAt: string | null; resolvedAt: string | null; pausedAt: string | null; csatComment: string; firstBreached: boolean; resolveBreached: boolean }; messages: Msg[]; others: { id: string; number: string; subject: string; status: Status; createdAt: string }[]; contact: { id: string; name: string; email: string; phone: string; lifecycle: string } | null; link: string; timing: { firstResponse: string | null; remaining: string | null } };

const useHd = () => useModule<Meta>();
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
const PRIORITY_TONE: Record<string, "neutral" | "warning" | "danger" | "accent"> = { low: "neutral", normal: "accent", high: "warning", urgent: "danger" };
const STATUS_TONE: Record<Status, "neutral" | "warning" | "danger" | "accent" | "success"> = { new: "accent", open: "accent", pending: "neutral", on_hold: "neutral", resolved: "success", closed: "neutral" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ");

function dueText(r: Pick<Row, "nextDue" | "overdue" | "dueKind">) {
  if (!r.nextDue) return null;
  const mins = Math.round((new Date(r.nextDue).getTime() - Date.now()) / 60_000);
  const abs = Math.abs(mins);
  const span = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`;
  const what = r.dueKind === "first" ? "Reply" : "Resolve";
  return mins < 0 ? `${what} overdue ${span}` : `${what} in ${span}`;
}

export function HelpdeskApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="helpdesk"
      base="helpdesk"
      title="Helpdesk"
      icon={<LifeBuoy />}
      section={section === "tickets" ? "" : section}
      nav={(m) => [
        { id: "", label: "Tickets", icon: <Inbox /> },
        { id: "canned", label: "Saved replies", icon: <MessageSquareText /> },
        { id: "reports", label: "Reports", icon: <BarChart3 /> },
        { id: "settings", label: "Settings", icon: <Settings />, hidden: !m.me.manage },
      ]}
      render={() => {
        if (section === "tickets" && id === "new") return <NewTicket />;
        if (section === "tickets" && isId(id)) return <TicketView key={id} id={id!} />;
        if (section === "canned") return <CannedView />;
        if (section === "reports") return <ReportsView />;
        if (section === "settings") return <SettingsView />;
        return <Inbox_ />;
      }}
    />
  );
}

const VIEWS = [
  ["open", "All open"],
  ["mine", "Mine"],
  ["unassigned", "Unassigned"],
  ["waiting", "Waiting"],
  ["breached", "Missed target"],
  ["done", "Resolved"],
] as const;

function Inbox_() {
  const { meta, orgId, go } = useHd();
  const qc = useQueryClient();
  const [view, setView] = useState<(typeof VIEWS)[number][0]>(meta.counts.mine ? "mine" : "open");
  const [q, setQ] = useState("");
  const list = useModuleQuery<{ tickets: Row[] }>(`tickets?${new URLSearchParams({ view, q })}`, { keepPrevious: true });
  const rows = list.data?.tickets;
  const count = (v: string) => (v in meta.counts ? meta.counts[v as keyof Counts] : null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tickets"
        description="Oldest due first. Targets count business hours and pause while a ticket waits on the customer."
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.me.write && <ImportButton target={target("helpdesk.tickets")} onImport={(rows, mode) => api(`/api/v1/orgs/${orgId}/helpdesk/tickets/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["helpdesk", orgId] })} />}
            <ExportMenu name="tickets" rows={rows} columns={[{ key: "number", label: "Number" }, { key: "subject", label: "Subject" }, { key: "status", label: "Status" }, { key: "priority", label: "Priority" }, { key: "channel", label: "Channel" }, { key: "customerName", label: "Customer" }, { key: "customerEmail", label: "Email" }, { key: "assignee", label: "Assignee" }, { key: "createdAt", label: "Created" }, { key: "nextDue", label: "Due" }, { key: "csat", label: "Rating" }]} />
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("tickets/new")}>New ticket</Button>}
          </div>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs value={view} onChange={setView} tabs={VIEWS.map(([v, l]) => ({ value: v, label: <span>{l}{count(v) !== null && <span className="ml-1.5 text-subtle tabular-nums">{count(v)}</span>}</span> }))} />
        <Input aria-label="Search tickets" className="!w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, subject or customer" />
      </div>
      {!rows ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !rows.length ? (
        <p className="rounded-[16px] border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted">{view === "mine" ? "Nothing on your plate." : "No tickets here."}</p>
      ) : (
        <div className={cx("overflow-x-auto rounded-[20px] border border-border bg-surface", list.isFetching && "opacity-80")}>
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Ticket</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Assignee</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-2" onClick={() => go(`tickets/${r.id}`)}>
                  <td className="px-4 py-2.5">
                    <Link href={`/helpdesk/tickets/${r.id}`} className="font-medium" onClick={(e) => e.stopPropagation()}>{r.subject}</Link>
                    <span className="block text-[12px] text-muted">{r.number} · {cap(r.channel)} · {when(r.createdAt)}</span>
                  </td>
                  <td className="px-4 py-2.5">{r.customerName || r.customerEmail || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap items-center gap-1.5"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>{r.priority !== "normal" && <Badge tone={PRIORITY_TONE[r.priority]}>{cap(r.priority)}</Badge>}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.assignee ?? "—"}</td>
                  <td className={cx("px-4 py-2.5 text-[12.5px]", r.overdue ? "font-medium text-danger" : "text-muted")}>{dueText(r) ?? (r.csat ? `Rated ${r.csat}/5` : "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewTicket() {
  const { meta, go } = useHd();
  const [f, setF] = useState({ subject: "", body: "", customerName: "", customerEmail: "", customerPhone: "", priority: "normal", channel: "phone", assigneeId: meta.me.id, acknowledge: true });
  const save = useModuleAction<void, { ticket: { id: string } }>(() => ({ path: "tickets", body: { ...f, assigneeId: f.assigneeId || null } }), { success: "Ticket logged", onDone: (r) => go(`tickets/${r.ticket.id}`) });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="New ticket" description="For a call, a walk-in or something that came in elsewhere." />
      <div className="grid gap-4 rounded-[20px] border border-border bg-surface p-5 sm:grid-cols-2">
        <Field label="Subject" className="sm:col-span-2">{(a) => <Input {...a} value={f.subject} maxLength={200} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
        <Field label="What they said" className="sm:col-span-2">{(a) => <Textarea {...a} rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <Field label="Customer name">{(a) => <Input {...a} value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />}</Field>
        <Field label="Customer email">{(a) => <Input {...a} type="email" value={f.customerEmail} onChange={(e) => setF({ ...f, customerEmail: e.target.value })} />}</Field>
        <Field label="Phone">{(a) => <Input {...a} value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} />}</Field>
        <Field label="Came in by">{(a) => <Select {...a} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</Select>}</Field>
        <Field label="Priority">{(a) => <Select {...a} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}</Select>}</Field>
        <Field label="Assignee">{(a) => <Select {...a} value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}><option value="">Nobody yet</option>{meta.agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <div className="sm:col-span-2"><Switch checked={f.acknowledge} onChange={(v) => setF({ ...f, acknowledge: v })} label="Email the customer their reference and link" /> <span className="ml-2 text-[13px] text-muted">Email the customer their reference and link</span></div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => go("")}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!f.subject.trim() || !(f.customerName || f.customerEmail || f.customerPhone)} onClick={() => save.mutate()}>Log ticket</Button>
      </div>
    </div>
  );
}

function TicketView({ id }: { id: string }) {
  const { meta } = useHd();
  const toast = useToast();
  const q = useModuleQuery<Detail>(`tickets/${id}`);
  const canned = useModuleQuery<{ canned: { id: string; title: string }[] }>("canned");
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [then, setThen] = useState<"" | Status>("");
  const patch = useModuleAction<Record<string, unknown>>((b) => ({ path: `tickets/${id}`, method: "PATCH", body: b }), { success: "Saved" });
  const send = useModuleAction<void>(() => ({ path: `tickets/${id}/replies`, body: { body, internal, ...(then ? { status: then } : {}) } }), { success: internal ? "Note added" : "Reply sent", onDone: () => (setBody(""), setThen("")) });
  const { orgId } = useHd();
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { ticket: t, messages, others, contact, timing } = q.data;
  const insertCanned = async (cid: string) => {
    const r = await api<{ body: string }>(`/api/v1/orgs/${orgId}/helpdesk/tickets/${id}/canned/${cid}`);
    setBody((b) => (b ? `${b}\n\n${r.body}` : r.body));
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <div>
          <p className="text-[12px] text-muted">{t.number} · {cap(t.channel)} · {when(t.createdAt)}</p>
          <h1 className="text-xl font-semibold">{t.subject}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5"><Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge><Badge tone={PRIORITY_TONE[t.priority]}>{cap(t.priority)}</Badge>{t.breached && <Badge tone="danger">Missed target</Badge>}{t.tags.map((x) => <Badge key={x}>{x}</Badge>)}</div>
        </div>
        <CustomFieldsCard entity="helpdesk.ticket" id={id} />
        <ol className="space-y-3">
          {messages.map((m) =>
            m.kind === "event" ? (
              <li key={m.id} className="px-1 text-[12px] text-subtle">{m.body}{m.author ? ` — ${m.author}` : ""} · {when(m.createdAt)}</li>
            ) : (
              <li key={m.id} className={cx("rounded-[16px] border px-4 py-3", m.kind === "customer" ? "border-border bg-surface" : m.kind === "note" ? "border-transparent bg-warning-soft" : "border-transparent bg-accent-soft")}>
                <p className="mb-1 text-[12px] text-muted"><b className="font-medium text-fg">{m.kind === "customer" ? m.fromName || m.fromEmail || "Customer" : m.author}</b> · {m.kind === "note" ? "Internal note" : m.kind === "reply" ? "Reply" : "Customer"} · {when(m.createdAt)}</p>
                <p className="text-[14px] whitespace-pre-wrap">{m.body}</p>
              </li>
            ),
          )}
        </ol>
        {meta.me.write && (
          <div className={cx("space-y-3 rounded-[20px] border p-4", internal ? "border-warning bg-warning-soft/40" : "border-border bg-surface")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs value={internal ? "note" : "reply"} onChange={(v) => setInternal(v === "note")} tabs={[{ value: "reply", label: "Reply to customer" }, { value: "note", label: "Internal note" }]} />
              {!!canned.data?.canned.length && (
                <Select aria-label="Saved reply" className="!w-48" value="" onChange={(e) => e.target.value && insertCanned(e.target.value)}>
                  <option value="">Insert a saved reply…</option>
                  {canned.data.canned.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </Select>
              )}
            </div>
            {!internal && !t.customerEmail && <Notice tone="warning">This ticket has no customer email, so replies can&apos;t be sent. Use an internal note to record what you told them.</Notice>}
            <Textarea aria-label={internal ? "Note" : "Reply"} rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? "Only your team sees this" : `Write to ${t.customerName || t.customerEmail}`} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select aria-label="Then set status" className="!w-64" value={then} onChange={(e) => setThen(e.target.value as Status | "")}>
                <option value="">{internal ? "Keep the status" : "Then: waiting on customer"}</option>
                {STATUSES.filter((s) => s !== "new").map((s) => <option key={s} value={s}>Then: {STATUS_LABEL[s].toLowerCase()}</option>)}
              </Select>
              <Button variant="primary" loading={send.isPending} disabled={!body.trim() || (!internal && !t.customerEmail)} onClick={() => send.mutate()}>{internal ? "Add note" : "Send reply"}</Button>
            </div>
          </div>
        )}
      </div>
      <aside className="space-y-4">
        <section className="space-y-3 rounded-[20px] border border-border bg-surface p-4">
          <Field label="Status">{(a) => <Select {...a} disabled={!meta.me.write} value={t.status} onChange={(e) => patch.mutate({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>}</Field>
          <Field label="Priority">{(a) => <Select {...a} disabled={!meta.me.write} value={t.priority} onChange={(e) => patch.mutate({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}</Select>}</Field>
          <Field label="Assignee">{(a) => <Select {...a} disabled={!meta.me.write} value={t.assigneeId ?? ""} onChange={(e) => patch.mutate({ assigneeId: e.target.value || null })}><option value="">Nobody</option>{meta.agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        </section>
        <section className="space-y-1 rounded-[20px] border border-border bg-surface p-4 text-[13px]">
          <h2 className="mb-1 text-[14px] font-semibold">Targets</h2>
          <p>First reply: {t.firstRespondedAt ? <>in {timing.firstResponse}{t.firstBreached && <span className="text-danger"> (late)</span>}</> : <span className={cx(t.overdue && t.dueKind === "first" && "text-danger")}>due {when(t.firstResponseDue)}</span>}</p>
          <p>Resolve: {t.resolvedAt ? `resolved ${when(t.resolvedAt)}` : t.pausedAt ? `paused — ${timing.remaining ?? "no time"} left` : <span className={cx(t.overdue && t.dueKind === "resolve" && "text-danger")}>due {when(t.resolveDue)}</span>}{t.resolveBreached && <span className="text-danger"> (late)</span>}</p>
          {t.csat && <p>Rating: {t.csat}/5{t.csatComment && ` — “${t.csatComment}”`}</p>}
        </section>
        <section className="space-y-1 rounded-[20px] border border-border bg-surface p-4 text-[13px]">
          <h2 className="mb-1 text-[14px] font-semibold">Customer</h2>
          <p className="font-medium">{t.customerName || "—"}</p>
          {t.customerEmail && <p className="text-muted">{t.customerEmail}</p>}
          {t.customerPhone && <p className="text-muted">{t.customerPhone}</p>}
          {contact && <Link href={`/crm/contacts/${contact.id}`} className="inline-block font-medium underline">Open in CRM</Link>}
          <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(q.data!.link).then(() => toast({ tone: "success", title: "Customer link copied" }))}>Copy their link</Button>
          {!!others.length && (
            <div className="pt-2">
              <p className="mb-1 text-[12px] font-medium text-muted">Other tickets</p>
              <ul className="space-y-1">{others.map((o) => <li key={o.id}><Link href={`/helpdesk/tickets/${o.id}`} className="hover:underline">{o.number} · {o.subject}</Link> <span className="text-subtle">({STATUS_LABEL[o.status]})</span></li>)}</ul>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function CannedView() {
  const { meta } = useHd();
  const list = useModuleQuery<{ canned: { id: string; title: string; body: string }[] }>("canned");
  const [edit, setEdit] = useState<{ id: string | null; title: string; body: string } | null>(null);
  const save = useModuleAction<void>(() => ({ path: edit?.id ? `canned/${edit.id}` : "canned", method: edit?.id ? "PUT" : "POST", body: { title: edit?.title, body: edit?.body } }), { success: "Saved", onDone: () => setEdit(null) });
  const del = useModuleAction<string>((id) => ({ path: `canned/${id}`, method: "DELETE" }), { success: "Deleted" });
  return (
    <div className="space-y-4">
      <PageHeader title="Saved replies" description="Answers you give often. {{name}}, {{ticket}} and {{agent}} are filled in for each ticket." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ id: null, title: "", body: "" })}>New saved reply</Button>} />
      {edit && (
        <div className="space-y-3 rounded-[20px] border border-border bg-surface p-4">
          <Field label="Title">{(a) => <Input {...a} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field>
          <Field label="Reply">{(a) => <Textarea {...a} rows={5} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />}</Field>
          <div className="flex gap-2"><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!edit.title.trim() || !edit.body.trim()} onClick={() => save.mutate()}>Save</Button></div>
        </div>
      )}
      {!list.data ? <Skeleton className="h-40 rounded-[20px]" /> : !list.data.canned.length ? <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">No saved replies yet.</p> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {list.data.canned.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <button type="button" className="min-w-0 text-left" onClick={() => meta.me.write && setEdit(c)}><b className="text-[14px] font-medium">{c.title}</b><span className="line-clamp-2 block text-[13px] text-muted">{c.body}</span></button>
              {meta.me.write && <IconButton size="sm" variant="ghost" label="Delete" onClick={() => del.mutate(c.id)}><Trash2 className="size-3.5" /></IconButton>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Stat = { tickets: number; open: number; firstMet: number | null; resolveMet: number | null; avgFirst: number | null; avgResolve: number | null; csat: number | null; happy: number | null; rated: number };

function ReportsView() {
  const q = useModuleQuery<{ from: string; to: string; overall: Stat; agents: (Stat & { id: string | null; name: string })[]; channels: { channel: string; tickets: number }[]; durations: { avgFirst: string | null; avgResolve: string | null } }>("reports");
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const { overall: o, durations: d } = q.data;
  const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
  const tiles: [string, string][] = [["Tickets", String(o.tickets)], ["First reply on time", pct(o.firstMet)], ["Resolved on time", pct(o.resolveMet)], ["Average first reply", d.avgFirst ?? "—"], ["Average to resolve", d.avgResolve ?? "—"], ["Satisfaction", o.csat === null ? "—" : `${o.csat}/5 (${o.rated} rated)`]];
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description={`Tickets opened ${q.data.from} to ${q.data.to}. Times are in business hours.`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([l, v]) => (
          <div key={l} className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">{l}</p><p className="mt-1 text-xl font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-[20px] border border-border bg-surface">
        <table className="w-full text-[13px]">
          <thead className="border-b border-border text-left text-muted"><tr><th className="px-4 py-2 font-medium">Agent</th><th className="px-4 py-2 text-right font-medium">Tickets</th><th className="px-4 py-2 text-right font-medium">Open</th><th className="px-4 py-2 text-right font-medium">First reply on time</th><th className="px-4 py-2 text-right font-medium">Resolved on time</th><th className="px-4 py-2 text-right font-medium">Rating</th></tr></thead>
          <tbody className="divide-y divide-border">
            {q.data.agents.map((a) => <tr key={a.id ?? "none"}><td className="px-4 py-2">{a.name}</td><td className="px-4 py-2 text-right tabular-nums">{a.tickets}</td><td className="px-4 py-2 text-right tabular-nums">{a.open}</td><td className="px-4 py-2 text-right tabular-nums">{pct(a.firstMet)}</td><td className="px-4 py-2 text-right tabular-nums">{pct(a.resolveMet)}</td><td className="px-4 py-2 text-right tabular-nums">{a.csat ?? "—"}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-muted">By channel: {q.data.channels.map((c) => `${cap(c.channel)} ${c.tickets}`).join(" · ") || "—"}</p>
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function SettingsView() {
  const { meta } = useHd();
  const [f, setF] = useState<HdSettings>(meta.settings);
  const [holidays, setHolidays] = useState(meta.settings.holidays.join(", "));
  const [rotate, setRotate] = useState(false);
  const inbound = useModuleQuery<{ url: string }>("inbound");
  const toast = useToast();
  const save = useModuleAction<void>(() => ({ path: "settings", method: "PUT", body: { ...f, holidays: holidays.split(/[\s,]+/).filter(Boolean) } }), { success: "Settings saved" });
  const rot = useModuleAction<void>(() => ({ path: "inbound/rotate" }), { success: "New inbound address made", onDone: () => setRotate(false) });
  const setSla = (p: keyof HdSettings["sla"], k: "first" | "resolve", hours: string) => setF({ ...f, sla: { ...f.sla, [p]: { ...f.sla[p], [k]: Math.max(1, Math.round(Number(hours) * 60)) } } });
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Helpdesk settings" />
      <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[14px] font-semibold">Business hours (India time)</h2>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => {
            const on = f.hours.days.includes(i + 1);
            return <button key={d} type="button" aria-pressed={on} onClick={() => setF({ ...f, hours: { ...f.hours, days: on ? f.hours.days.filter((x) => x !== i + 1) : [...f.hours.days, i + 1].sort() } })} className={cx("rounded-full border px-3 py-1 text-[13px]", on ? "border-fg bg-fg text-bg" : "border-border text-muted")}>{d}</button>;
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Opens">{(a) => <Input {...a} type="time" value={f.hours.start} onChange={(e) => setF({ ...f, hours: { ...f.hours, start: e.target.value } })} />}</Field>
          <Field label="Closes">{(a) => <Input {...a} type="time" value={f.hours.end} onChange={(e) => setF({ ...f, hours: { ...f.hours, end: e.target.value } })} />}</Field>
          <Field label="Ticket prefix">{(a) => <Input {...a} value={f.prefix} maxLength={10} onChange={(e) => setF({ ...f, prefix: e.target.value })} />}</Field>
        </div>
        <Field label="Holidays" hint="Dates as YYYY-MM-DD, separated by commas">{(a) => <Input {...a} value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder="2026-11-09, 2026-12-25" />}</Field>
      </section>
      <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[14px] font-semibold">Response targets (business hours)</h2>
        <FormLines className="w-full text-[13px]">
          <thead className="text-left text-muted"><tr><th className="py-1 font-medium">Priority</th><th className="py-1 font-medium">First reply within</th><th className="py-1 font-medium">Resolve within</th></tr></thead>
          <tbody>
            {PRIORITIES.map((p) => (
              <tr key={p}>
                <td className="py-1">{cap(p)}</td>
                <td className="py-1 pr-3"><Input aria-label={`${p} first reply hours`} type="number" min={0.25} step={0.25} value={f.sla[p].first / 60} onChange={(e) => setSla(p, "first", e.target.value)} /></td>
                <td className="py-1"><Input aria-label={`${p} resolve hours`} type="number" min={0.5} step={0.5} value={f.sla[p].resolve / 60} onChange={(e) => setSla(p, "resolve", e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </FormLines>
      </section>
      <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[14px] font-semibold">Assignment and follow-up</h2>
        <Field label="New tickets">{(a) => <Select {...a} value={f.assignment} onChange={(e) => setF({ ...f, assignment: e.target.value as HdSettings["assignment"] })}><option value="none">Wait for someone to pick them up</option><option value="round_robin">Give to agents in turn</option></Select>}</Field>
        {f.assignment === "round_robin" && (
          <div className="flex flex-wrap gap-2">
            {meta.agents.map((a) => {
              const on = f.agents.includes(a.id);
              return <button key={a.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, agents: on ? f.agents.filter((x) => x !== a.id) : [...f.agents, a.id] })} className={cx("rounded-full border px-3 py-1 text-[13px]", on ? "border-fg bg-fg text-bg" : "border-border text-muted")}>{a.name}</button>;
            })}
            <p className="w-full text-[12px] text-muted">{f.agents.length ? "Only these people take turns." : "Nobody picked: every agent takes turns."}</p>
          </div>
        )}
        <Field label="Close resolved tickets after (days, 0 = never)">{(a) => <Input {...a} type="number" min={0} max={90} value={f.autoCloseDays} onChange={(e) => setF({ ...f, autoCloseDays: Number(e.target.value) })} />}</Field>
        <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.csat} onChange={(v) => setF({ ...f, csat: v })} label="Ask for a rating when resolved" /> Ask for a rating when resolved</label>
      </section>
      <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[14px] font-semibold">Email</h2>
        <Field label="Your support address (Reply-To)" hint="Forward this address to the inbound address below so customers' replies come back as tickets.">{(a) => <Input {...a} type="email" value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} placeholder="support@yourcompany.in" />}</Field>
        <Field label="Signature">{(a) => <Textarea {...a} rows={3} value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} />}</Field>
        <div>
          <p className="text-[13px] font-medium">Inbound address</p>
          <p className="mb-2 text-[12.5px] text-muted">Set your email provider&apos;s inbound parse (Postmark inbound, or anything that can POST JSON with from, subject and text) to send email here. Keep it secret: anyone with it can open tickets.</p>
          <div className="flex gap-2"><Input readOnly aria-label="Inbound address" value={inbound.data?.url ?? ""} /><IconButton label="Copy" onClick={() => inbound.data && navigator.clipboard.writeText(inbound.data.url).then(() => toast({ tone: "success", title: "Copied" }))}><Copy className="size-3.5" /></IconButton><Button icon={<RefreshCw className="size-3.5" />} onClick={() => setRotate(true)}>New address</Button></div>
        </div>
      </section>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
      <ConfirmDialog open={rotate} onClose={() => setRotate(false)} onConfirm={() => rot.mutate()} loading={rot.isPending} destructive title="Make a new inbound address?" description="The current address stops working at once. Update your email provider with the new one, or customer emails will be lost." confirmLabel="Make a new one" />
    </div>
  );
}
