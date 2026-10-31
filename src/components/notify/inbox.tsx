"use client";

// "My work": what's waiting on you across Cloudesk (approvals, leave, claims,
// attendance corrections, timesheets, tasks due), your notifications, the
// requests you've sent, reminders, and who stands in for you while you're away.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CheckCheck, Inbox, Plus, Trash2, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApprovalCard, type ApprovalView } from "@/components/approvals/card";
import { useSession } from "@/components/shell/session-context";
import { Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { APPROVAL_KINDS } from "@/lib/approvals/model";
import { ago, useMarkRead, useNotifications } from "./bell";

type Todo = { id: string; source: string; title: string; detail: string; link: string; due: string | null; overdue: boolean };
type Reminder = { id: string; at: string; title: string; note: string; link: string };
type Work = { approvals: ApprovalView[]; todo: Todo[]; reminders: Reminder[]; counts: { approvals: number; todo: number; overdue: number } };
type Delegation = { id: string; fromUserId: string; toUserId: string; fromName: string; toName: string; starts: string; ends: string; kinds: string[]; note: string };
type Tab = "todo" | "notifications" | "mine" | "away";

function useOrgQuery<T>(path: string | null) {
  const { org } = useSession();
  return useQuery({ queryKey: ["inbox", org.id, path], queryFn: () => api<T>(`/api/v1/orgs/${org.id}/${path}`), enabled: !!path, refetchInterval: 60_000 });
}
function useOrgAction<B>(fn: (b: B) => { path: string; method?: string; body?: unknown }, success?: string, onDone?: () => void) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return api(`/api/v1/orgs/${org.id}/${r.path}`, { method: r.method ?? "POST", body: r.body ?? {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox", org.id] });
      qc.invalidateQueries({ queryKey: ["notify", org.id] });
      if (success) toast({ tone: "success", title: success });
      onDone?.();
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function InboxView() {
  const [tab, setTab] = useState<Tab>("todo");
  const work = useOrgQuery<Work>("inbox");
  const notes = useNotifications(100);
  const [reminding, setReminding] = useState(false);
  const c = work.data?.counts;
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 lg:py-8">
      <PageHeader
        title="My work"
        description="Everything waiting on you, across Cloudesk."
        actions={
          <Button size="sm" icon={<AlarmClock className="size-3.5" />} onClick={() => setReminding(true)}>
            Remind me
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-5"
        tabs={[
          { value: "todo", label: `To do${c ? ` · ${c.approvals + c.todo}` : ""}` },
          { value: "notifications", label: `Notifications${notes.data?.unread ? ` · ${notes.data.unread} new` : ""}` },
          { value: "mine", label: "My requests" },
          { value: "away", label: "When I'm away" },
        ]}
      />
      {tab === "todo" && <TodoTab work={work.data} />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "mine" && <MineTab />}
      {tab === "away" && <AwayTab />}
      {reminding && <ReminderDialog onClose={() => setReminding(false)} />}
    </div>
  );
}

function TodoTab({ work }: { work?: Work }) {
  const del = useOrgAction<string>((id) => ({ path: `notifications/reminders/${id}`, method: "DELETE" }), "Reminder removed");
  if (!work) return <Skeleton className="h-[50vh] rounded-[24px]" />;
  if (!work.approvals.length && !work.todo.length && !work.reminders.length) return <EmptyState icon={<Inbox className="size-5" />} title="Nothing waiting on you" description="Approvals, leave and claims to decide, timesheets to approve and tasks due today show up here." />;
  return (
    <div className="grid gap-6">
      {work.approvals.length > 0 && (
        <section>
          <h2 className="mb-2 text-[14px] font-semibold">To approve · {work.approvals.length}</h2>
          <div className="grid gap-3">
            {work.approvals.map((a) => (
              <ApprovalCard key={a.id} a={a} compact />
            ))}
          </div>
        </section>
      )}
      {work.todo.length > 0 && (
        <section>
          <h2 className="mb-2 text-[14px] font-semibold">Also waiting on you · {work.todo.length}</h2>
          <ul className="divide-y divide-border rounded-[18px] border border-border bg-surface shadow-sm">
            {work.todo.map((t) => (
              <li key={t.id}>
                <Link href={t.link} className="flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-surface-2/60">
                  <span className="hidden w-28 shrink-0 text-[11.5px] font-semibold tracking-wide text-subtle uppercase sm:block">{t.source}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10.5px] font-semibold tracking-wide text-subtle uppercase sm:hidden">{t.source}</span>
                    <b className="block truncate font-medium">{t.title}</b>
                    {t.detail && <span className="block truncate text-[12px] text-muted">{t.detail}</span>}
                  </span>
                  {t.due && <span className={cx("shrink-0 text-[12px] tabular-nums", t.overdue ? "font-semibold text-danger" : "text-muted")}>{t.overdue ? "Overdue · " : ""}{new Date(t.due.length === 10 ? `${t.due}T00:00:00Z` : t.due).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: t.due.length === 10 ? "UTC" : "Asia/Kolkata" })}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {work.reminders.length > 0 && (
        <section>
          <h2 className="mb-2 text-[14px] font-semibold">Reminders</h2>
          <ul className="divide-y divide-border rounded-[18px] border border-border bg-surface shadow-sm">
            {work.reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <AlarmClock className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  {r.link ? <Link href={r.link} className="font-medium hover:underline">{r.title}</Link> : <b className="font-medium">{r.title}</b>}
                  {r.note && <span className="block text-[12px] text-muted">{r.note}</span>}
                </span>
                <span className="text-[12px] text-muted">{fmtWhen(r.at)}</span>
                <button type="button" aria-label={`Remove reminder ${r.title}`} onClick={() => del.mutate(r.id)} className="text-subtle hover:text-danger">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const DELIVERY: Record<string, string> = { recorded: "email recorded — no mail service set up", sent: "emailed", queued: "email queued", retrying: "email retrying", failed: "email failed" };
function NotificationsTab() {
  const q = useNotifications(100);
  const read = useMarkRead();
  if (!q.data) return <Skeleton className="h-[40vh] rounded-[24px]" />;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">{q.data.unread ? `${q.data.unread} unread` : "All caught up"}</h2>
        {q.data.unread > 0 && <Button size="sm" variant="ghost" icon={<CheckCheck className="size-3.5" />} onClick={() => read.mutate("all")}>Mark all read</Button>}
      </div>
      {!q.data.items.length ? (
        <EmptyState icon={<Inbox className="size-5" />} title="No notifications yet" />
      ) : (
        <ul className="divide-y divide-border rounded-[18px] border border-border bg-surface shadow-sm">
          {q.data.items.map((n) => (
            <li key={n.id} className={cx("flex gap-3 px-4 py-3 text-[13px]", !n.readAt && "bg-accent-soft/25")}>
              <span aria-hidden className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
              <span className="min-w-0 flex-1">
                {n.link ? <Link href={n.link} onClick={() => !n.readAt && read.mutate([n.id])} className="font-medium hover:underline">{n.title}</Link> : <b className="font-medium">{n.title}</b>}
                {n.body && <span className="mt-0.5 block whitespace-pre-line text-[12.5px] text-muted">{n.body}</span>}
                <span className="mt-0.5 block text-[11.5px] text-subtle">{ago(n.createdAt)}{n.email ? ` · ${DELIVERY[n.email] ?? n.email}` : ""}</span>
              </span>
              {!n.readAt && <button type="button" onClick={() => read.mutate([n.id])} className="self-start text-[12px] font-medium text-muted hover:text-fg">Mark read</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MineTab() {
  const q = useOrgQuery<{ requests: ApprovalView[] }>("approvals/mine");
  if (!q.data) return <Skeleton className="h-[40vh] rounded-[24px]" />;
  if (!q.data.requests.length) return <EmptyState icon={<UserRoundCheck className="size-5" />} title="You haven't sent anything for approval" description="When a bill, order, journal, claim or payroll run you make needs approval, you can follow it here." />;
  return (
    <div className="grid gap-3">
      {q.data.requests.map((a) => (
        <ApprovalCard key={a.id} a={a} compact />
      ))}
    </div>
  );
}

function AwayTab() {
  const { user } = useSession();
  const q = useOrgQuery<{ delegations: Delegation[] }>("approvals/delegations");
  const meta = useOrgQuery<{ people: { id: string; name: string }[] }>("approvals/meta");
  const [f, setF] = useState(() => {
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    return { toUserId: "", starts: today, ends: today, kinds: [] as string[], note: "" };
  });
  const add = useOrgAction<void>(() => ({ path: "approvals/delegations", body: f }), "They'll approve for you on those days", () => setF((x) => ({ ...x, toUserId: "", note: "" })));
  const del = useOrgAction<string>((id) => ({ path: `approvals/delegations/${id}`, method: "DELETE" }), "Removed");
  return (
    <div className="grid gap-5">
      <section className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-[14px] font-semibold">Someone to approve for you</h2>
        <p className="mt-1 text-[12.5px] text-muted">On these days they can approve anything waiting on you. It&apos;s recorded as approved by them on your behalf.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Who" className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={f.toUserId} onChange={(e) => setF({ ...f, toUserId: e.target.value })}>
                <option value="">Pick someone</option>
                {meta.data?.people.filter((x) => x.id !== user.id).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={f.ends} onChange={(e) => setF({ ...f, ends: e.target.value })} />}</Field>
        </div>
        <fieldset className="mt-3">
          <legend className="text-[13px] font-medium">For</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries(APPROVAL_KINDS).map(([k, d]) => {
              const on = f.kinds.includes(k);
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => setF({ ...f, kinds: on ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] })} className={cx("h-8 rounded-full px-3 text-[12.5px] font-medium", on ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>
                  {d.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11.5px] text-subtle">{f.kinds.length ? "Only these." : "Nothing picked means everything."}</p>
        </fieldset>
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="primary" disabled={!f.toUserId} loading={add.isPending} onClick={() => add.mutate()}>
            Add
          </Button>
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-[14px] font-semibold">Current and coming up</h2>
        {!q.data?.delegations.length ? (
          <p className="rounded-[16px] border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted">No one is standing in for anyone.</p>
        ) : (
          <ul className="divide-y divide-border rounded-[18px] border border-border bg-surface shadow-sm">
            {q.data.delegations.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  <b className="font-medium">{d.toName}</b> approves for <b className="font-medium">{d.fromName}</b>
                  <span className="block text-[12px] text-muted">
                    {d.starts} to {d.ends} · {d.kinds.length ? d.kinds.map((k) => APPROVAL_KINDS[k as keyof typeof APPROVAL_KINDS]?.label ?? k).join(", ") : "everything"}
                  </span>
                </span>
                <button type="button" aria-label="Remove" onClick={() => del.mutate(d.id)} className="text-subtle hover:text-danger">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReminderDialog({ onClose }: { onClose: () => void }) {
  const [at, setAt] = useState(() => new Date(Date.now() + 3600_000 + 5.5 * 3600_000).toISOString().slice(0, 16));
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const add = useOrgAction<void>(() => ({ path: "notifications/reminders", body: { at: `${at}:00+05:30`, title, note, link } }), "We'll remind you", onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Remind me"
      description="You'll get it in the app and by email (unless you've switched reminder emails off)."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Plus className="size-3.5" />} disabled={!title.trim()} loading={add.isPending} onClick={() => add.mutate()}>
            Add reminder
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="About">{(p) => <Input {...p} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call the auditor" />}</Field>
        <Field label="When (India time)">{(p) => <Input {...p} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}</Field>
        <Field label="Note">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Field label="Link in Cloudesk" hint="Optional, like /accounts/bills">{(p) => <Input {...p} value={link} onChange={(e) => setLink(e.target.value)} placeholder="/…" />}</Field>
      </div>
    </Dialog>
  );
}
