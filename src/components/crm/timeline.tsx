"use client";

// The composer (note, call, email, meeting, task) and the timeline under it.
// Shared by the contact, company and deal pages.
import { CalendarClock, Check, CheckSquare, Mail, MessageSquareText, MoreHorizontal, Phone, Sparkles, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Menu } from "@/components/ui/overlays";
import { Button, Input, Notice, Select, Textarea, cx } from "@/components/ui/primitives";
import { CALL_OUTCOMES, MEETING_OUTCOMES } from "@/lib/crm/model";
import { quickDue } from "./dialogs";
import { ago, ownerName, timeLabel, useCrm, useCrmAction, type Activity } from "./shared";

type Target = { contactId?: string | null; companyId?: string | null; dealId?: string | null; email?: string; doNotContact?: boolean };
type Kind = "note" | "call" | "email" | "meeting" | "task";
const KIND_ICON: Record<string, ReactNode> = { note: <MessageSquareText />, call: <Phone />, email: <Mail />, meeting: <CalendarClock />, task: <CheckSquare />, event: <Sparkles /> };
const KIND_TONE: Record<string, string> = { note: "bg-[#fef9c3] text-[#854d0e]", call: "bg-[#dcfce7] text-[#166534]", email: "bg-[#e0f2fe] text-[#075985]", meeting: "bg-[#ede9fe] text-[#5b21b6]", task: "bg-[#ffedd5] text-[#9a3412]", event: "bg-surface-2 text-muted" };
const OUTCOME: Record<string, string> = { connected: "Connected", no_answer: "No answer", voicemail: "Left voicemail", busy: "Busy", wrong_number: "Wrong number", held: "Held", no_show: "No-show", rescheduled: "Rescheduled" };

export function Composer({ target, defaultKind = "note" }: { target: Target; defaultKind?: Kind }) {
  const { meta } = useCrm();
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("connected");
  const [duration, setDuration] = useState("");
  const [due, setDue] = useState(quickDue("tomorrow"));
  const reset = () => (setSubject(""), setBody(""), setDuration(""));
  const ids = { contactId: target.contactId ?? null, companyId: target.companyId ?? null, dealId: target.dealId ?? null };
  const log = useCrmAction(
    () => ({
      path: "activities",
      body: {
        kind,
        ...ids,
        subject: kind === "call" && !subject ? `Call — ${OUTCOME[outcome]}` : subject,
        body,
        outcome: kind === "call" || kind === "meeting" ? (kind === "meeting" && new Date(due) > new Date() ? "" : outcome) : "",
        durationMin: duration ? Number(duration) : null,
        dueAt: kind === "task" || kind === "meeting" ? (due ? new Date(due).toISOString() : null) : null,
      },
    }),
    { success: kind === "task" ? "Task added" : kind === "meeting" && new Date(due) > new Date() ? "Meeting scheduled" : "Logged", onDone: reset },
  );
  const send = useCrmAction<void, { delivered: boolean }>(() => ({ path: `contacts/${target.contactId}/email`, body: { subject, body, dealId: target.dealId ?? null } }), { success: (r) => (r.delivered ? "Email sent" : "Email recorded — set up mail to deliver it"), onDone: reset });
  const tabs: { id: Kind; label: string }[] = [
    { id: "note", label: "Note" },
    { id: "call", label: "Call" },
    { id: "email", label: "Email" },
    { id: "meeting", label: "Meeting" },
    { id: "task", label: "Task" },
  ];
  if (!meta.me.write) return null;
  const canEmail = !!target.contactId;
  const busy = log.isPending || send.isPending;
  const meetingLater = kind === "meeting" && !!due && new Date(due) > new Date();
  return (
    <div className="rounded-[20px] border border-border bg-surface p-3 shadow-sm">
      <div role="tablist" aria-label="Log an activity" className="mb-3 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={kind === t.id} onClick={() => setKind(t.id)} className={cx("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium [&_svg]:size-3.5", kind === t.id ? "bg-fg text-bg" : "text-muted hover:bg-surface-2")}>
            {KIND_ICON[t.id]}
            {t.label}
          </button>
        ))}
      </div>
      {kind === "email" && !canEmail ? (
        <p className="px-1 py-3 text-[13px] text-muted">Email goes to a person — open a contact to write to them.</p>
      ) : kind === "email" && !target.email ? (
        <p className="px-1 py-3 text-[13px] text-muted">This contact has no email address yet.</p>
      ) : kind === "email" && target.doNotContact ? (
        <p className="px-1 py-3 text-[13px] text-muted">They asked not to be contacted, so email is switched off.</p>
      ) : (
        <div className="grid gap-2">
          {kind === "email" && (
            <>
              {meta.mail === "outbox" && <Notice tone="warning">Mail isn&apos;t set up for this workspace yet — the email is saved on the timeline but not delivered.</Notice>}
              {meta.settings.settings.templates.length > 0 && (
                <Select
                  aria-label="Use a template"
                  value=""
                  onChange={(e) => {
                    const t = meta.settings.settings.templates.find((x) => x.id === e.target.value);
                    if (t) {
                      setSubject(t.subject);
                      setBody(t.body);
                    }
                  }}
                >
                  <option value="">Use a template…</option>
                  {meta.settings.settings.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </>
          )}
          {(kind === "email" || kind === "task" || kind === "meeting") && <Input aria-label={kind === "task" ? "What needs doing?" : "Subject"} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={kind === "task" ? "What needs doing?" : kind === "meeting" ? "Meeting title" : "Subject"} maxLength={200} />}
          {kind !== "task" && <Textarea aria-label={kind === "note" ? "Note" : "Details"} rows={kind === "email" ? 6 : 3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "note" ? "Write a note… (only your team sees it)" : kind === "call" ? "What was said?" : kind === "email" ? "Hi {{first_name}}, …" : "Agenda or notes"} maxLength={10000} />}
          <div className="flex flex-wrap items-center gap-2">
            {kind === "call" && (
              <>
                <Select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="!w-auto">
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {OUTCOME[o]}
                    </option>
                  ))}
                </Select>
                <Input aria-label="Minutes" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Minutes" className="!w-24" />
              </>
            )}
            {(kind === "task" || kind === "meeting") && (
              <>
                <Input aria-label={kind === "task" ? "Due" : "When"} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="!w-auto" />
                {kind === "task" &&
                  (
                    [
                      ["today", "Today"],
                      ["tomorrow", "Tomorrow"],
                      ["week", "Next week"],
                    ] as const
                  ).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setDue(quickDue(k))} className="h-7 rounded-full border border-border px-2.5 text-[12px] font-medium hover:bg-surface-2">
                      {l}
                    </button>
                  ))}
                {kind === "meeting" && !meetingLater && (
                  <Select aria-label="Outcome" value={MEETING_OUTCOMES.includes(outcome as (typeof MEETING_OUTCOMES)[number]) ? outcome : "held"} onChange={(e) => setOutcome(e.target.value)} className="!w-auto">
                    {MEETING_OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {OUTCOME[o]}
                      </option>
                    ))}
                  </Select>
                )}
              </>
            )}
            {kind === "email" && <span className="text-[11.5px] text-subtle">Merge fields: {"{{first_name}}"}, {"{{company}}"}, {"{{owner_name}}"}</span>}
            <Button
              variant="primary"
              size="sm"
              className="ml-auto"
              loading={busy}
              disabled={kind === "task" ? !subject.trim() : kind === "email" ? !subject.trim() || !body.trim() : kind === "meeting" ? !subject.trim() && !body.trim() : kind === "call" ? false : !body.trim()}
              onClick={() => (kind === "email" ? send.mutate() : log.mutate())}
            >
              {kind === "email" ? "Send email" : kind === "task" ? "Add task" : meetingLater ? "Schedule" : kind === "call" ? "Log call" : kind === "meeting" ? "Log meeting" : "Save note"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "note", label: "Notes" },
  { id: "call", label: "Calls" },
  { id: "email", label: "Emails" },
  { id: "meeting", label: "Meetings" },
  { id: "task", label: "Tasks" },
  { id: "event", label: "Updates" },
] as const;

export function Timeline({ items, showWhat }: { items: Activity[]; showWhat?: boolean }) {
  const { meta } = useCrm();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const toggle = useCrmAction<{ id: string; done: boolean }>((b) => ({ path: `activities/${b.id}`, method: "PUT", body: { done: b.done } }), { success: (r) => ((r as { activity: Activity }).activity.doneAt ? "Done" : "Reopened") });
  const del = useCrmAction<string>((id) => ({ path: `activities/${id}`, method: "DELETE" }), { success: "Deleted" });
  const list = items.filter((a) => filter === "all" || a.kind === filter);
  const upcoming = list.filter((a) => !a.doneAt && (a.kind === "task" || a.kind === "meeting"));
  const past = list.filter((a) => !upcoming.includes(a));
  const row = (a: Activity) => {
    const open = !a.doneAt && (a.kind === "task" || a.kind === "meeting");
    const late = open && a.dueAt && new Date(a.dueAt) < new Date();
    return (
      <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
        <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px bg-border last:hidden" />
        <span className={cx("relative grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4", KIND_TONE[a.kind])}>{KIND_ICON[a.kind]}</span>
        <div className={cx("min-w-0 flex-1", a.kind === "event" ? "pt-1.5" : "rounded-[16px] border border-border bg-surface p-3 shadow-sm")}>
          <div className="flex items-start gap-2">
            {a.kind === "task" && meta.me.write && (
              <button type="button" aria-label={a.doneAt ? "Mark not done" : "Mark done"} onClick={() => toggle.mutate({ id: a.id, done: !a.doneAt })} className={cx("mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[6px] border-[1.5px]", a.doneAt ? "border-success bg-success text-white" : "border-border hover:border-fg/50")}>
                {a.doneAt && <Check className="size-3" strokeWidth={3} />}
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className={cx("text-[13.5px]", a.kind === "event" ? "text-muted" : "font-semibold", a.kind === "task" && a.doneAt && "text-subtle line-through")}>
                {a.subject || (a.kind === "note" ? "Note" : a.kind[0].toUpperCase() + a.kind.slice(1))}
                {a.outcome && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">{OUTCOME[a.outcome] ?? a.outcome}</span>}
                {a.kind === "email" && a.meta?.sent === true && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">{a.meta.transport === "outbox" ? "Recorded" : "Sent"}{a.meta.sequence ? " · sequence" : ""}</span>}
              </p>
              {a.body && <p className="mt-1 text-[13px] whitespace-pre-wrap text-fg/80">{a.body}</p>}
              <p className="mt-1.5 flex flex-wrap gap-x-2 text-[11.5px] text-subtle">
                {showWhat && (a.contact || a.deal) && <span className="font-medium text-muted">{a.contact || a.deal}</span>}
                {open && a.dueAt ? <span className={cx(late && "font-semibold text-danger")}>{a.kind === "meeting" ? "On" : "Due"} {timeLabel(a.dueAt)}{late ? " · overdue" : ""}</span> : <span title={timeLabel(a.doneAt ?? a.createdAt)}>{ago(a.doneAt ?? a.createdAt)}</span>}
                {a.durationMin ? <span>{a.durationMin} min</span> : null}
                {a.kind !== "event" && <span>{ownerName(meta, a.ownerId)}</span>}
                {a.kind === "event" && a.createdBy && <span>by {ownerName(meta, a.createdBy)}</span>}
              </p>
            </div>
            {a.kind !== "event" && meta.me.write && (meta.me.manage || a.createdBy === meta.me.id) && (
              <Menu
                label="Activity actions"
                trigger={(p) => (
                  <button {...p} type="button" aria-label="More" className="grid size-7 place-items-center rounded-full text-subtle hover:bg-surface-2 hover:text-fg">
                    <MoreHorizontal className="size-4" />
                  </button>
                )}
                items={[...(a.kind === "meeting" && !a.doneAt ? [{ label: "Mark as held", icon: <Check className="size-4" />, onSelect: () => toggle.mutate({ id: a.id, done: true }) }] : []), { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => del.mutate(a.id) }]}
              />
            )}
          </div>
        </div>
      </li>
    );
  };
  return (
    <div>
      <div className="mb-3 flex gap-1 overflow-x-auto">
        {FILTERS.map((f) => {
          const n = f.id === "all" ? items.length : items.filter((a) => a.kind === f.id).length;
          if (f.id !== "all" && !n) return null;
          return (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} className={cx("h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium", filter === f.id ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}>
              {f.label} <span className="text-subtle tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>
      {!list.length ? (
        <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">Nothing here yet. Log a call, write a note or add a task above.</p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">Coming up</p>
              <ol className="mb-5">{upcoming.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "")).map(row)}</ol>
            </>
          )}
          {past.length > 0 && (
            <>
              {upcoming.length > 0 && <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">History</p>}
              <ol>{past.map(row)}</ol>
            </>
          )}
        </>
      )}
    </div>
  );
}

