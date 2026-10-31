"use client";

// Recurring emails: the list (what's running, paused or finished, and when
// each sends next), the editor (the email; when it repeats, at what times, in
// which zone, skipped days and the end; the meeting it's about; and how it
// behaves), and each schedule's history — every send, skip and failure.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CalendarDays, CheckCircle2, Clock3, Copy, FastForward, MoreHorizontal, Paperclip, Pause, Pencil, Play, Plus, Repeat, Send, SkipForward, Sparkles, Trash2, Users, Video, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, Menu, Segmented, useToast } from "@/components/ui/overlays";
import { Button, EmptyState, ErrorState, Field, Input, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import type { CalMetaOut } from "@/lib/calendar/api";
import { findMeetingLink, providerName } from "@/lib/calendar/detect";
import type { Repeat as RepeatRule } from "@/lib/calendar/recur";
import type { ContactsOut, MetaOut, ScheduleOut, ScheduleRunOut } from "@/lib/mail/api";
import { dayOf, describeSchedule, plainTitle, REPEAT_PRESETS, RUN_PLACEHOLDERS, timeLabel, upcoming, type ScheduleIn } from "@/lib/mail/schedule";
import { visibleTo } from "@/lib/workspace/modules";
import { Recipients, type GroupChip } from "./compose";
import { useSignatures } from "./signatures";
import { fileSize, mailKey, useMailApi } from "./shared";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC"];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const HALF_HOURS = Array.from({ length: 34 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const MAX_FILE = 15 * 1024 * 1024;
const localZone = () => {
  try {
    // Some browsers still report India's old zone name.
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    return z === "Asia/Calcutta" ? "Asia/Kolkata" : z;
  } catch {
    return "Asia/Kolkata";
  }
};
const when = (iso: string, tz: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
const relative = (iso: string) => {
  const ms = Date.parse(iso) - Date.now();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "any moment";
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
};

/** What the editor starts from: a schedule being changed, or a fresh one (possibly from the composer). */
export type ScheduleDraft = Partial<ScheduleIn> & { groups?: GroupChip[]; files?: { id: string; filename: string; size: number }[]; pending?: { filename: string; mime: string; data: string; size: number }[] };

// ── The page ────────────────────────────────────────────────────────────────

export function RecurringMail({ meta }: { meta: MetaOut }) {
  const { orgId, call } = useMailApi();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "paused" | "ended" | "all">("all");
  const [editing, setEditing] = useState<ScheduleDraft & { id?: string } | null>(params.get("new") ? {} : null);
  const q = useQuery({ queryKey: mailKey(orgId, "schedules"), queryFn: () => call<{ schedules: ScheduleOut[] }>("schedules"), refetchInterval: 60_000 });
  const open = params.get("open");
  const list = (q.data?.schedules ?? []).filter((s) => tab === "all" || s.status === tab);
  const counts = { active: 0, paused: 0, ended: 0, ...Object.fromEntries(["active", "paused", "ended"].map((k) => [k, (q.data?.schedules ?? []).filter((s) => s.status === k).length])) } as Record<string, number>;
  const go = (id: string | null) => router.replace(id ? `/mail/recurring?open=${id}` : "/mail/recurring");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
      <Link href="/mail" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Back to mail</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.02em]"><Repeat className="size-5 text-accent" /> Recurring emails</h1>
          <p className="mt-1 max-w-xl text-[13.5px] text-muted">The same email on a schedule — every day, on weekdays, on chosen days, monthly or yearly, at the times you pick. Meetings in them go straight into your calendar.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>New recurring email</Button>
      </div>
      <div className="mt-5">
        <Segmented label="Show" value={tab} onChange={setTab} options={[{ value: "all", label: `All${q.data ? ` · ${q.data.schedules.length}` : ""}` }, { value: "active", label: `Running · ${counts.active}` }, { value: "paused", label: `Paused · ${counts.paused}` }, { value: "ended", label: `Finished · ${counts.ended}` }]} />
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2.5">
        {q.isLoading ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-[18px]" />)
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : !list.length ? (
          <EmptyState icon={<Repeat className="size-5" />} title={tab === "all" ? "No recurring emails yet" : "Nothing here"} description="A daily stand-up invite, a weekly report, a monthly reminder to pay — write it once and it goes out on its own." action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>New recurring email</Button>} />
        ) : (
          list.map((s) => <Card key={s.id} s={s} meta={meta} onOpen={() => go(s.id)} onEdit={() => setEditing(fromSchedule(s))} />)
        )}
      </div>
      {open && <Details id={open} meta={meta} onClose={() => go(null)} onEdit={(s) => setEditing(fromSchedule(s))} />}
      {editing && <ScheduleEditor meta={meta} draft={editing} id={editing.id} onClose={() => setEditing(null)} onSaved={(s) => { setEditing(null); go(s.id); }} />}
    </div>
  );
}

function fromSchedule(s: ScheduleOut): ScheduleDraft & { id: string } {
  const { id, name, accountId, to, cc, bcc, groupIds, separately, subject, body, signatureId, startDate, times, tz, repeat, skipDates, limit, thread, stopOnReply, missed, notifyEach, meeting, files } = s;
  return { id, name, accountId, to, cc, bcc, groupIds, separately, subject, body, signatureId, startDate, times, tz, repeat, skipDates, limit, thread, stopOnReply, missed, notifyEach, meeting, files };
}

const STATUS: Record<ScheduleOut["status"], { label: string; cls: string }> = {
  active: { label: "Running", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  paused: { label: "Paused", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  ended: { label: "Finished", cls: "bg-surface-2 text-muted" },
};

function useScheduleAct() {
  const { orgId, call } = useMailApi();
  const qc = useQueryClient();
  const toast = useToast();
  return async (path: string, method: string, ok?: string) => {
    try {
      const r = await call<{ schedule?: ScheduleOut }>(path, method);
      if (ok) toast({ tone: "success", title: ok });
      await qc.invalidateQueries({ queryKey: mailKey(orgId, "schedules") });
      await qc.invalidateQueries({ queryKey: mailKey(orgId, "schedule") });
      return r;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return null;
    }
  };
}

function actionsFor(s: ScheduleOut, act: ReturnType<typeof useScheduleAct>, onEdit: () => void, onDelete: () => void) {
  return [
    { label: "Edit", icon: <Pencil />, onSelect: onEdit },
    ...(s.status === "active"
      ? [
          { label: "Send one now", icon: <Send />, onSelect: () => void act(`schedules/${s.id}/send-now`, "POST", "Sent — it's on its way") },
          { label: "Skip the next one", icon: <SkipForward />, disabled: !s.nextRunAt, onSelect: () => void act(`schedules/${s.id}/skip`, "POST", "Next one skipped") },
          { label: "Pause", icon: <Pause />, onSelect: () => void act(`schedules/${s.id}/pause`, "POST", "Paused") },
        ]
      : [{ label: s.status === "paused" ? "Resume" : "Start again", icon: <Play />, onSelect: () => void act(`schedules/${s.id}/resume`, "POST", "Running again") }]),
    { label: "Duplicate", icon: <Copy />, onSelect: () => void act(`schedules/${s.id}/duplicate`, "POST", "Copied — it's running") },
    "separator" as const,
    { label: "Delete", icon: <Trash2 />, danger: true, onSelect: onDelete },
  ];
}

function Card({ s, meta, onOpen, onEdit }: { s: ScheduleOut; meta: MetaOut; onOpen: () => void; onEdit: () => void }) {
  const act = useScheduleAct();
  const [del, setDel] = useState(false);
  const acc = meta.accounts.find((a) => a.id === s.accountId);
  const people = [...s.to, ...s.cc].length + s.bcc.length;
  return (
    <div className="group flex min-w-0 items-start gap-3 overflow-hidden rounded-[18px] border border-border bg-surface-solid p-3.5 transition-shadow sm:p-4 hover:shadow-[0_8px_24px_-16px_rgba(0,0,0,0.25)]">
      <span className={cx("mt-0.5 grid size-10 shrink-0 place-items-center rounded-[12px]", s.status === "active" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted")}><Repeat className="size-[18px]" /></span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{s.name || s.subject}</span>
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[s.status].cls)}>{STATUS[s.status].label}</span>
          {s.meeting?.addToCalendar && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300"><Video className="size-3" />Meeting</span>}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-muted sm:truncate">{s.name ? `${s.subject} · ` : ""}{s.describe}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
          {s.status === "active" && s.nextRunAt ? <span className="inline-flex items-center gap-1 font-medium text-fg"><Clock3 className="size-3.5 text-accent" />Next {when(s.nextRunAt, s.tz)} · {relative(s.nextRunAt)}</span> : s.statusNote ? <span>{s.statusNote}</span> : null}
          <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{people} {people === 1 ? "person" : "people"}{s.groupIds.length ? ` + ${s.groupIds.length} group${s.groupIds.length === 1 ? "" : "s"}` : ""}</span>
          <span className="inline-flex items-center gap-1"><CheckCircle2 className="size-3.5" />{s.sentCount} sent{s.limit ? ` of ${s.limit}` : ""}</span>
          {acc && <span className="max-w-full truncate">from {acc.address}</span>}
        </p>
      </button>
      <Menu label="Recurring email actions" trigger={(p) => <button {...p} type="button" aria-label="Actions" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><MoreHorizontal className="size-4" /></button>} items={actionsFor(s, act, onEdit, () => setDel(true))} />
      <ConfirmDialog open={del} title={`Delete “${s.name || s.subject}”?`} description={s.eventId ? "Nothing more will be sent, and its meetings leave your calendar. Emails already sent stay in Sent." : "Nothing more will be sent. Emails already sent stay in Sent."} confirmLabel="Delete" destructive onClose={() => setDel(false)} onConfirm={async () => { setDel(false); await act(`schedules/${s.id}`, "DELETE", "Deleted"); }} />
    </div>
  );
}

// ── One schedule: what's coming, what happened ──────────────────────────────

function Details({ id, meta, onClose, onEdit }: { id: string; meta: MetaOut; onClose: () => void; onEdit: (s: ScheduleOut) => void }) {
  const { orgId, call } = useMailApi();
  const act = useScheduleAct();
  const [del, setDel] = useState(false);
  const q = useQuery({ queryKey: mailKey(orgId, "schedule", id), queryFn: () => call<{ schedule: ScheduleOut; runs: ScheduleRunOut[] }>(`schedules/${id}`), refetchInterval: 30_000 });
  const s = q.data?.schedule;
  const acc = s && meta.accounts.find((a) => a.id === s.accountId);
  return (
    <Dialog open onClose={onClose} size="lg" title={s ? s.name || s.subject : "Recurring email"} description={s?.describe}>
      {!s ? (
        q.isError ? <ErrorState message={errorMessage(q.error)} /> : <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("rounded-full px-2.5 py-1 text-[12px] font-semibold", STATUS[s.status].cls)}>{STATUS[s.status].label}</span>
            {s.statusNote && <span className="text-[12.5px] text-muted">{s.statusNote}</span>}
            <span className="ml-auto flex flex-wrap gap-1.5">
              {s.status === "active" ? (
                <>
                  <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => void act(`schedules/${s.id}/send-now`, "POST", "Sent — it's on its way")}>Send now</Button>
                  <Button size="sm" icon={<SkipForward className="size-3.5" />} disabled={!s.nextRunAt} onClick={() => void act(`schedules/${s.id}/skip`, "POST", "Next one skipped")}>Skip next</Button>
                  <Button size="sm" icon={<Pause className="size-3.5" />} onClick={() => void act(`schedules/${s.id}/pause`, "POST", "Paused")}>Pause</Button>
                </>
              ) : (
                <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => void act(`schedules/${s.id}/resume`, "POST", "Running again")}>{s.status === "paused" ? "Resume" : "Start again"}</Button>
              )}
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(s)}>Edit</Button>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(true)}>Delete</Button>
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Sent" value={`${s.sentCount}${s.limit ? ` / ${s.limit}` : ""}`} />
            <Stat label="Next" value={s.nextRunAt ? when(s.nextRunAt, s.tz) : "—"} sub={s.nextRunAt ? relative(s.nextRunAt) : undefined} />
            <Stat label="From" value={acc?.address ?? "—"} sub={s.tz} />
          </div>
          {s.meeting?.addToCalendar && (
            <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-sky-500/25 bg-sky-500/5 px-4 py-3 text-[13px]">
              <Video className="size-4 text-sky-600" />
              <span className="min-w-0 flex-1"><b className="font-semibold">{plainTitle(s.meeting.title) || plainTitle(s.subject) || "Meeting"}</b> · {s.meeting.durationMin} min{s.meeting.at ? ` at ${timeLabel(s.meeting.at)}` : " when it's sent"}{s.meeting.link ? ` · ${providerName(findMeetingLink(s.meeting.link)?.provider) || "Video call"}` : ""}{s.meeting.invite ? " · invite in each email" : ""}</span>
              {s.eventId && <Link href={`/calendar?event=${s.eventId}`} className="font-semibold text-sky-700 hover:underline dark:text-sky-300">In your calendar →</Link>}
            </div>
          )}
          {s.upcoming.length > 0 && (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Coming up</h3>
              <ul className="grid gap-1 sm:grid-cols-2">{s.upcoming.slice(0, 6).map((u, i) => <li key={u} className="flex items-center gap-2 rounded-[10px] bg-surface-2/60 px-3 py-1.5 text-[13px]"><CalendarClock className="size-3.5 text-muted" />{when(u, s.tz)}{i === 0 && <span className="ml-auto text-[11.5px] text-muted">{relative(u)}</span>}</li>)}</ul>
            </section>
          )}
          <section>
            <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">History</h3>
            {!q.data!.runs.length ? <p className="text-[13px] text-muted">Nothing has gone out yet.</p> : (
              <ul className="grid divide-y divide-border rounded-[14px] border border-border">
                {q.data!.runs.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                    <span className={cx("size-2 shrink-0 rounded-full", r.status === "sent" ? "bg-emerald-500" : r.status === "failed" ? "bg-red-500" : r.status === "pending" ? "bg-sky-500" : "bg-zinc-400")} />
                    <span className="w-44 shrink-0 tabular-nums">{when(r.plannedFor, s.tz)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{r.status === "sent" ? `#${r.n} sent to ${r.recipients} ${r.recipients === 1 ? "person" : "people"}${r.manual ? " · sent now" : ""}` : r.status === "pending" ? "Sending…" : `${r.status === "failed" ? "Failed" : "Skipped"}${r.note ? ` — ${r.note}` : ""}`}</span>
                    {r.threadId && <Link href={`/mail/t/${r.threadId}`} className="shrink-0 text-[12.5px] font-medium text-accent hover:underline">Open</Link>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ConfirmDialog open={del} title="Delete this recurring email?" description="Nothing more will be sent; its meetings leave your calendar. Emails already sent stay in Sent." confirmLabel="Delete" destructive onClose={() => setDel(false)} onConfirm={async () => { setDel(false); if (await act(`schedules/${s.id}`, "DELETE", "Deleted")) onClose(); }} />
        </div>
      )}
    </Dialog>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[14px] border border-border px-3.5 py-2.5">
      <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-0.5 truncate text-[14px] font-semibold">{value}</p>
      {sub && <p className="text-[11.5px] text-muted">{sub}</p>}
    </div>
  );
}

// ── The editor ──────────────────────────────────────────────────────────────

type MeetingState = { on: boolean; title: string; at: string | null; durationMin: number; link: string; makeLink: boolean; addToCalendar: boolean; calendarId: string | null; invite: boolean; details: boolean; reminders: number[] };

export function ScheduleEditor({ meta, draft, id, onClose, onSaved }: { meta: MetaOut; draft: ScheduleDraft; id?: string; onClose: () => void; onSaved: (s: ScheduleOut) => void }) {
  const { orgId, call } = useMailApi();
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const sendable = meta.accounts.filter((a) => a.status !== "paused");
  const zone = draft.tz ?? localZone();
  const [accountId, setAccountId] = useState(draft.accountId ?? sendable[0]?.id ?? "");
  const [name, setName] = useState(draft.name ?? "");
  const [to, setTo] = useState<string[]>(draft.to ?? []);
  const [cc, setCc] = useState<string[]>(draft.cc ?? []);
  const [bcc, setBcc] = useState<string[]>(draft.bcc ?? []);
  const [showCc, setShowCc] = useState(!!(draft.cc?.length || draft.bcc?.length));
  const [groups, setGroups] = useState<GroupChip[]>(draft.groups ?? []);
  const [separately, setSeparately] = useState(draft.separately ?? false);
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  const [signatureId, setSignatureId] = useState<string | null | undefined>(draft.signatureId);
  const [keep, setKeep] = useState(draft.files ?? []);
  const [pending, setPending] = useState(draft.pending ?? []);
  // The moment the editor opened: the preview counts from here.
  const [opened] = useState(() => Date.now());
  const [startDate, setStartDate] = useState(() => draft.startDate ?? dayOf(Date.now(), zone));
  const [times, setTimes] = useState<string[]>(draft.times ?? ["09:00"]);
  const [tz, setTz] = useState(zone);
  const [repeat, setRepeat] = useState<RepeatRule>({ freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5], until: null, count: null, ...(draft.repeat ?? {}) } as RepeatRule);
  const [ends, setEnds] = useState<"never" | "date" | "count">(draft.limit ? "count" : draft.repeat?.until ? "date" : "never");
  const [limit, setLimit] = useState<number>(draft.limit ?? 10);
  const [skipDates, setSkipDates] = useState<string[]>(draft.skipDates ?? []);
  const [skipInput, setSkipInput] = useState("");
  const [thread, setThread] = useState<"new" | "same">(draft.thread ?? "new");
  const [stopOnReply, setStopOnReply] = useState(draft.stopOnReply ?? false);
  const [missed, setMissed] = useState<"send" | "skip">(draft.missed ?? "send");
  const [notifyEach, setNotifyEach] = useState(draft.notifyEach ?? false);
  const detected = findMeetingLink(`${subject}\n${body}`);
  const dm = draft.meeting;
  // On by itself while a meeting link is in the email, until you flip it yourself.
  const [meetingChoice, setMeetingChoice] = useState<boolean | null>(dm ? dm.addToCalendar !== false || dm.invite !== false : null);
  const [meetingState, setMeeting] = useState<MeetingState>({ on: false, title: dm?.title ?? "", at: dm?.at ?? null, durationMin: dm?.durationMin ?? 30, link: dm?.link ?? "", makeLink: dm?.makeLink ?? false, addToCalendar: dm?.addToCalendar ?? true, calendarId: dm?.calendarId ?? null, invite: dm?.invite ?? true, details: dm?.details ?? true, reminders: dm?.reminders ?? [10, 0] });
  const meeting = { ...meetingState, on: meetingChoice ?? !!detected };
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sigQ = useSignatures();
  const contacts = useQuery({ queryKey: mailKey(orgId, "contacts-groups"), queryFn: () => call<ContactsOut>("contacts?limit=1"), enabled: !!draft.groupIds?.length && !draft.groups, staleTime: 60_000 });
  const calOn = visibleTo(org, "calendar");
  const cals = useQuery({ queryKey: ["calendar", orgId, "meta"], queryFn: () => api<CalMetaOut>(`/api/v1/orgs/${orgId}/calendar/meta`), enabled: calOn && meeting.on, staleTime: 60_000 });
  // Groups on a saved schedule are ids; show them by name once the address book answers.
  const shownGroups = groups.length || !draft.groupIds?.length ? groups : (contacts.data?.groups ?? []).filter((g) => draft.groupIds!.includes(g.id)).map((g) => ({ id: g.id, name: g.name, count: g.count, color: g.color }));
  const preset = REPEAT_PRESETS.find((p) => p.repeat.freq === repeat.freq && p.repeat.interval === repeat.interval && [...p.repeat.byDay].sort().join() === [...repeat.byDay].sort().join())?.id ?? "custom";
  const effectiveRepeat: RepeatRule = useMemo(() => ({ ...repeat, until: ends === "date" ? repeat.until : null, count: null }), [repeat, ends]);
  const preview = useMemo(() => {
    try {
      return upcoming({ startDate, times, tz, repeat: effectiveRepeat, skipDates }, opened, ends === "count" ? Math.min(8, limit) : 8);
    } catch {
      return [];
    }
  }, [startDate, times, tz, effectiveRepeat, skipDates, ends, limit, opened]);

  const insert = (tok: string) => {
    const el = bodyRef.current;
    const at = el?.selectionStart ?? body.length;
    setBody(`${body.slice(0, at)}${tok}${body.slice(at)}`);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + tok.length, at + tok.length);
    });
  };
  const addFiles = async (list: FileList) => {
    for (const f of [...list]) {
      if (f.size > MAX_FILE) {
        toast({ tone: "error", title: `${f.name} is over 15 MB` });
        continue;
      }
      const data = await new Promise<string>((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",")[1] ?? "");
        r.onerror = () => bad(r.error);
        r.readAsDataURL(f);
      });
      setPending((p) => [...p, { filename: f.name, mime: f.type || "application/octet-stream", data, size: f.size }]);
    }
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    const groupIds = shownGroups.map((g) => g.id);
    const payload: ScheduleIn = {
      name, accountId, to, cc, bcc, groupIds, separately: separately && to.length + groupIds.length > 1, subject: subject.trim(), body,
      ...(signatureId !== undefined ? { signatureId } : {}),
      startDate, times, tz, repeat: effectiveRepeat, skipDates, limit: ends === "count" ? limit : null,
      thread: separately ? "new" : thread, stopOnReply, missed, notifyEach,
      meeting: meeting.on || detected ? { title: meeting.title, at: meeting.at, durationMin: meeting.durationMin, link: meeting.makeLink ? meeting.link.startsWith("https://meet.jit.si/") ? meeting.link : "" : meeting.link, makeLink: meeting.makeLink, addToCalendar: meeting.on && meeting.addToCalendar, calendarId: meeting.calendarId, invite: meeting.on && meeting.invite, details: meeting.on && meeting.details, reminders: meeting.reminders } : null,
      attachments: pending.map(({ filename, mime, data }) => ({ filename, mime, data })),
      keepFiles: keep.map((f) => f.id),
    };
    try {
      const r = await call<{ schedule: ScheduleOut }>(id ? `schedules/${id}` : "schedules", id ? "PUT" : "POST", payload);
      await qc.invalidateQueries({ queryKey: mailKey(orgId, "schedules") });
      await qc.invalidateQueries({ queryKey: mailKey(orgId, "schedule") });
      toast({ tone: "success", title: id ? "Saved" : "Recurring email set", description: r.schedule.nextRunAt ? `First one goes ${when(r.schedule.nextRunAt, r.schedule.tz)}.` : undefined });
      onSaved(r.schedule);
    } catch (e) {
      const f = e instanceof ApiClientError ? e.fieldErrors() : {};
      setErrors(Object.fromEntries(Object.entries(f).map(([k, v]) => [k.split(".")[0]!, v[0] ?? ""])));
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <span className="mr-auto hidden text-[12.5px] text-muted sm:block">{preview[0] ? <>First: <b className="font-semibold text-fg">{when(new Date(preview[0]).toISOString(), tz)}</b></> : "No sends with these settings"}</span>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} icon={<Repeat className="size-4" />} onClick={() => void save()} disabled={!sendable.length}>{id ? "Save changes" : "Start schedule"}</Button>
    </>
  );

  return (
    <Dialog open onClose={onClose} size="2xl" title={id ? "Edit recurring email" : "New recurring email"} description="Write it once — it goes out on its own, at the times you choose." footer={footer}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid min-w-0 gap-6">
          {/* ── The email ── */}
          <Section icon={<Send />} title="The email">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name (only you see it)">{(p) => <Input {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Daily stand-up" />}</Field>
              <Field label="Send from" error={errors.accountId}>{(p) => <Select {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>{sendable.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.address}</option>)}</Select>}</Field>
            </div>
            <div className="grid gap-1.5 rounded-[14px] border border-border p-2">
              <Recipients label="To" value={to} onChange={setTo} groups={shownGroups} onGroups={setGroups} />
              {showCc ? (
                <>
                  <Recipients label="Cc" value={cc} onChange={setCc} />
                  <Recipients label="Bcc" value={bcc} onChange={setBcc} />
                </>
              ) : (
                <button type="button" onClick={() => setShowCc(true)} className="w-fit px-2 text-[12.5px] font-medium text-accent hover:underline">Add Cc / Bcc</button>
              )}
            </div>
            {errors.to && <p className="text-[12.5px] text-danger">{errors.to}</p>}
            <Field label="Subject" error={errors.subject}>{(p) => <Input {...p} value={subject} maxLength={500} onChange={(e) => setSubject(e.target.value)} placeholder="Stand-up for {{date}}" />}</Field>
            <Field label="Message" hint={<span className="flex flex-wrap items-center gap-1">Filled in each time: {["{{first_name}}", ...RUN_PLACEHOLDERS].map((t) => <button key={t} type="button" onClick={() => insert(t)} className="rounded-full border border-border px-1.5 py-px font-mono text-[11px] hover:border-accent hover:text-accent">{t}</button>)}</span>}>
              {(p) => <Textarea {...p} ref={bodyRef} rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Hi {{first_name}},\n\nHere's the plan for {{day}}…"} />}
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" icon={<Paperclip className="size-3.5" />} onClick={() => fileInput.current?.click()}>Attach</Button>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
              {[...keep.map((f) => ({ key: f.id, name: f.filename, size: f.size, drop: () => setKeep(keep.filter((x) => x.id !== f.id)) })), ...pending.map((f, i) => ({ key: `p${i}`, name: f.filename, size: f.size, drop: () => setPending(pending.filter((_, j) => j !== i)) }))].map((f) => (
                <span key={f.key} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-[12px]"><Paperclip className="size-3" />{f.name}<span className="text-muted">{fileSize(f.size)}</span><button type="button" aria-label={`Remove ${f.name}`} onClick={f.drop} className="grid size-5 place-items-center rounded-full hover:bg-fg/10"><X className="size-3" /></button></span>
              ))}
              {!!sigQ.data?.signatures.length && (
                <Select aria-label="Signature" className="ml-auto h-8 w-auto text-[12.5px]" value={signatureId === undefined ? "__default" : signatureId === null ? "__none" : signatureId} onChange={(e) => setSignatureId(e.target.value === "__default" ? undefined : e.target.value === "__none" ? null : e.target.value)}>
                  <option value="__default">Default signature</option>
                  <option value="__none">No signature</option>
                  {sigQ.data.signatures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              )}
            </div>
          </Section>

          {/* ── When ── */}
          <Section icon={<CalendarDays />} title="When it goes">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Repeats">
                {(p) => (
                  <Select {...p} value={preset} onChange={(e) => { const x = REPEAT_PRESETS.find((r) => r.id === e.target.value); if (x) setRepeat({ ...x.repeat, until: repeat.until }); else setRepeat({ ...repeat }); }}>
                    {REPEAT_PRESETS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    <option value="custom">Custom…</option>
                  </Select>
                )}
              </Field>
              <Field label="Starting" error={errors.startDate}>{(p) => <Input {...p} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
            </div>
            {preset === "custom" && (
              <div className="grid gap-3 rounded-[14px] bg-surface-2/60 p-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
                <Field label="Every">{(p) => <Input {...p} type="number" min={1} max={99} value={repeat.interval} onChange={(e) => setRepeat({ ...repeat, interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} className="w-20" />}</Field>
                <Field label="Unit">{(p) => <Select {...p} value={repeat.freq} onChange={(e) => setRepeat({ ...repeat, freq: e.target.value as RepeatRule["freq"], byDay: e.target.value === "weekly" ? repeat.byDay : [] })}><option value="daily">day(s)</option><option value="weekly">week(s)</option><option value="monthly">month(s)</option><option value="yearly">year(s)</option></Select>}</Field>
                {repeat.freq === "weekly" && <DayPicker value={repeat.byDay} onChange={(byDay) => setRepeat({ ...repeat, byDay })} />}
              </div>
            )}
            {preset !== "custom" && repeat.freq === "weekly" && repeat.byDay.length > 0 && preset !== "weekdays" && <DayPicker value={repeat.byDay} onChange={(byDay) => setRepeat({ ...repeat, byDay })} />}
            <div>
              <p className="mb-1.5 text-[13px] font-medium">At {times.length > 1 && <span className="font-normal text-muted">({times.length} times a day)</span>}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {times.map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-0.5">
                    <Input type="time" aria-label={`Send time ${i + 1}`} value={t} onChange={(e) => e.target.value && setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => setTimes([...new Set(times)].sort())} className="h-9 w-[124px]" />
                    {times.length > 1 && <button type="button" aria-label={`Remove ${timeLabel(t)}`} onClick={() => setTimes(times.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><X className="size-3.5" /></button>}
                  </span>
                ))}
                {times.length < 6 && <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => { const last = [...times].sort().at(-1) ?? "09:00"; const h = Math.min(23, +last.slice(0, 2) + 4); const next = `${String(h).padStart(2, "0")}:${last.slice(3)}`; setTimes([...new Set([...times, times.includes(next) ? "23:30" : next])].sort()); }}>Add another time</Button>}
              </div>
              {errors.times && <p className="mt-1 text-[12.5px] text-danger">{errors.times}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Time zone">{(p) => <Select {...p} value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, localZone(), ...ZONES])].map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>}</Field>
              <div>
                <p className="mb-1.5 text-[13px] font-medium">Ends</p>
                <Segmented label="Ends" value={ends} onChange={setEnds} options={[{ value: "never", label: "Never" }, { value: "date", label: "On a date" }, { value: "count", label: "After" }]} />
              </div>
            </div>
            {ends === "date" && <Field label="Last day" error={errors.repeat}>{(p) => <Input {...p} type="date" min={startDate} value={repeat.until ?? ""} onChange={(e) => setRepeat({ ...repeat, until: e.target.value || null })} />}</Field>}
            {ends === "count" && <Field label="Number of emails">{(p) => <Input {...p} type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} className="w-28" />}</Field>}
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Skip these days <span className="font-normal text-muted">(holidays, leave)</span></p>
              <div className="flex flex-wrap items-center gap-1.5">
                {skipDates.map((d) => <span key={d} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-[12.5px]">{new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}<button type="button" aria-label={`Don't skip ${d}`} onClick={() => setSkipDates(skipDates.filter((x) => x !== d))} className="grid size-5 place-items-center rounded-full hover:bg-fg/10"><X className="size-3" /></button></span>)}
                <Input type="date" aria-label="Day to skip" min={startDate} value={skipInput} onChange={(e) => setSkipInput(e.target.value)} className="h-8 w-[150px]" />
                <Button size="sm" variant="ghost" disabled={!skipInput || skipDates.includes(skipInput)} onClick={() => { setSkipDates([...skipDates, skipInput].sort()); setSkipInput(""); }}>Skip it</Button>
              </div>
            </div>
          </Section>

          {/* ── Meeting ── */}
          <Section icon={<Video />} title="Meeting" aside={<Switch label="This email is about a meeting" checked={meeting.on} onChange={setMeetingChoice} />}>
            {detected && <p className="flex items-center gap-2 rounded-[12px] bg-sky-500/8 px-3 py-2 text-[12.5px] text-sky-800 dark:text-sky-200"><Sparkles className="size-3.5 shrink-0" />Found a {providerName(detected.provider) || "meeting"} link in the email{meeting.on ? " — it'll be added to your calendar." : ". Turn this on to put the meetings in your calendar."}</p>}
            {meeting.on ? (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                  <Field label="Meeting title">{(p) => <Input {...p} value={meeting.title} maxLength={200} onChange={(e) => setMeeting({ ...meeting, title: e.target.value })} placeholder={plainTitle(subject) || "Stand-up"} />}</Field>
                  <Field label="Starts">{(p) => <Select {...p} value={meeting.at ?? "__send"} onChange={(e) => setMeeting({ ...meeting, at: e.target.value === "__send" ? null : e.target.value })}><option value="__send">When it&apos;s sent</option>{[...new Set([...HALF_HOURS, ...(meeting.at ? [meeting.at] : [])])].sort().map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}</Select>}</Field>
                  <Field label="Length">{(p) => <Select {...p} value={meeting.durationMin} onChange={(e) => setMeeting({ ...meeting, durationMin: Number(e.target.value) })}>{DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${d / 60} h`}</option>)}</Select>}</Field>
                </div>
                {times.length > 1 && !meeting.at && <p className="text-[12px] text-muted">With several send times, the meeting is at the first one each day ({timeLabel([...times].sort()[0]!)}).</p>}
                <div className="grid gap-2">
                  <Segmented label="Meeting link" value={meeting.makeLink ? "make" : "own"} onChange={(v) => setMeeting({ ...meeting, makeLink: v === "make" })} options={[{ value: "own", label: detected ? "Use the link in the email" : "Paste a link" }, { value: "make", label: "Create a video room" }]} />
                  {!meeting.makeLink && !detected && <Input aria-label="Meeting link" value={meeting.link} onChange={(e) => setMeeting({ ...meeting, link: e.target.value })} placeholder="https://meet.google.com/… or Zoom, Teams…" />}
                  {meeting.makeLink && <p className="text-[12px] text-muted">A Jitsi Meet room (free, no account) is made once and used every day — {meeting.link.startsWith("https://meet.jit.si/") ? meeting.link : "it's created when you save"}.</p>}
                  {errors.meeting && <p className="text-[12.5px] text-danger">{errors.meeting}</p>}
                </div>
                <div className="grid gap-2.5 rounded-[14px] border border-border p-3">
                  <Toggle on={meeting.addToCalendar} set={(v) => setMeeting({ ...meeting, addToCalendar: v })} title="Add to my calendar" sub="One repeating event that follows this schedule — paused, skipped and ended days included." disabled={!calOn} />
                  {meeting.addToCalendar && calOn && !!cals.data?.calendars.length && (
                    <Select aria-label="Calendar" className="ml-12 h-8 w-auto text-[12.5px]" value={meeting.calendarId ?? ""} onChange={(e) => setMeeting({ ...meeting, calendarId: e.target.value || null })}>
                      <option value="">Default calendar</option>
                      {cals.data.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  )}
                  <Toggle on={meeting.invite} set={(v) => setMeeting({ ...meeting, invite: v })} title="Send a calendar invite with each email" sub="Recipients get Accept / Decline, and the day's meeting lands in their calendar." />
                  <Toggle on={meeting.details} set={(v) => setMeeting({ ...meeting, details: v })} title="Add the time and join link under the message" />
                  <div className="flex flex-wrap items-center gap-2 pl-12 text-[12.5px]">
                    <span className="text-muted">Remind me</span>
                    {[0, 5, 10, 15, 30, 60].map((r) => {
                      const on = meeting.reminders.includes(r);
                      return <button key={r} type="button" aria-pressed={on} onClick={() => setMeeting({ ...meeting, reminders: on ? meeting.reminders.filter((x) => x !== r) : [...meeting.reminders, r].sort((a, b) => b - a) })} className={cx("rounded-full border px-2 py-0.5", on ? "border-accent bg-accent/10 font-semibold text-accent" : "border-border hover:bg-surface-2")}>{r === 0 ? "as it starts" : `${r} min before`}</button>;
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] text-muted">Turn on for stand-ups, reviews and other regular calls: each email can carry the day&apos;s invite, and the meetings go into your calendar automatically.</p>
            )}
          </Section>

          {/* ── Options ── */}
          <Section icon={<FastForward />} title="Advanced">
            <div className="grid gap-2.5">
              <Toggle on={separately} set={setSeparately} title="Send one each, personally" sub="Each person in To gets their own copy with their name filled in; nobody sees the others." />
              <Toggle on={thread === "same" && !separately} set={(v) => setThread(v ? "same" : "new")} disabled={separately} title="Keep them in one conversation" sub="Each email replies to the last, so it all stays in one thread for everyone." />
              <Toggle on={stopOnReply} set={setStopOnReply} title="Stop when anyone replies" sub="Good for reminders and follow-ups: the first reply ends the schedule." />
              <Toggle on={missed === "skip"} set={(v) => setMissed(v ? "skip" : "send")} title="Skip a send that's missed" sub="If Cloudesk was offline at the time, don't send it late (otherwise it goes when it can, up to 12 hours later)." />
              <Toggle on={notifyEach} set={setNotifyEach} title="Tell me each time one goes out" sub="You're always told if one fails, pauses or finishes." />
            </div>
          </Section>
        </div>

        {/* ── Live preview ── */}
        <aside className="h-fit rounded-[18px] border border-border bg-surface-2/40 p-4 lg:sticky lg:top-0">
          <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">Schedule</p>
          <p className="mt-1 text-[14px] font-semibold leading-snug">{describeSchedule({ times, repeat: effectiveRepeat, limit: ends === "count" ? limit : null, skipDates })}</p>
          <p className="mt-0.5 text-[12px] text-muted">{tz.replace(/_/g, " ")}</p>
          <p className="mt-4 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Next sends</p>
          {preview.length ? (
            <ol className="mt-1.5 grid gap-1">
              {preview.map((ms, i) => <li key={ms} className="flex items-center gap-2 text-[12.5px]"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent/10 text-[10.5px] font-bold text-accent">{i + 1}</span>{when(new Date(ms).toISOString(), tz)}</li>)}
            </ol>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-danger">No sends with these settings — check the start, the end and the days.</p>
          )}
          {(meeting.on || detected) && meeting.on && (
            <div className="mt-4 rounded-[12px] border border-sky-500/25 bg-sky-500/5 p-2.5 text-[12px]">
              <p className="flex items-center gap-1.5 font-semibold text-sky-800 dark:text-sky-200"><Video className="size-3.5" />{plainTitle(meeting.title) || plainTitle(subject) || "Meeting"}</p>
              <p className="mt-0.5 text-muted">{meeting.durationMin} min · {meeting.at ? timeLabel(meeting.at) : "as it's sent"}{meeting.addToCalendar ? " · in your calendar" : ""}{meeting.invite ? " · invite attached" : ""}</p>
            </div>
          )}
        </aside>
      </div>
    </Dialog>
  );
}

function Section({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold"><span className="grid size-7 place-items-center rounded-[9px] bg-accent/10 text-accent [&>svg]:size-3.5">{icon}</span>{title}{aside && <span className="ml-auto">{aside}</span>}</h3>
      {children}
    </section>
  );
}

function Toggle({ on, set, title, sub, disabled }: { on: boolean; set: (v: boolean) => void; title: string; sub?: string; disabled?: boolean }) {
  return (
    <label className={cx("flex items-start gap-3", disabled && "opacity-50")}>
      <Switch label={title} checked={on} onChange={set} disabled={disabled} />
      <span className="grid gap-0.5"><span className="text-[13.5px] font-medium">{title}</span>{sub && <span className="text-[12px] text-muted">{sub}</span>}</span>
    </label>
  );
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Days of the week">
      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
        const on = value.includes(d);
        return <button key={d} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())} className={cx("h-8 w-11 rounded-full border text-[12.5px] font-medium transition-colors", on ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-surface-2")}>{DAYS[d]}</button>;
      })}
    </div>
  );
}
