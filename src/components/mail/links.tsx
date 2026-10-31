"use client";

// An email into the rest of Cloudesk, from the conversation: save it to
// Notes (a new note or one you have; the whole thing, the latest message,
// one message, or an AI summary with its to-dos), put it in the calendar (a
// meeting with its people — time and link read from the email — or time set
// aside to deal with it), make it a task, share it in Chat. "Connected" lists
// everything it became, and every one of those links back to the email.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, ListChecks, MessagesSquare, NotebookPen, Search, Share2, Sparkles, Unlink, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useShareToChat } from "@/components/chat/share";
import { useSession } from "@/components/shell/session-context";
import { Dialog, Menu, Segmented, useToast, type MenuItem } from "@/components/ui/overlays";
import { Button, Field, Input, Select, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { findMeetingLink, findMeetingTime, providerName } from "@/lib/calendar/detect";
import type { ConnectionOut, LinkTargetsOut, MessageOut, MetaOut, ThreadOut } from "@/lib/mail/api";
import { writtenPart } from "@/lib/mail/links";
import { mailKey, personName, useMailApi } from "./shared";

type Kind = "note" | "event" | "task" | "chat";
type Open = { kind: "note"; messageId?: string } | { kind: "event"; focus?: boolean } | { kind: "task" } | null;

const KIND: Record<Kind, { icon: ReactNode; tone: string; label: string }> = {
  note: { icon: <NotebookPen />, tone: "bg-amber-500/12 text-amber-700 dark:text-amber-300", label: "Note" },
  event: { icon: <CalendarPlus />, tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300", label: "Calendar" },
  task: { icon: <ListChecks />, tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", label: "Task" },
  chat: { icon: <MessagesSquare />, tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300", label: "Chat" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tzOf = () => {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    return z === "Asia/Calcutta" ? "Asia/Kolkata" : z;
  } catch {
    return "Asia/Kolkata";
  }
};

/** Everything for one conversation: the menu, the "Connected" list, and the dialogs. */
export function useMailLinks(d: ThreadOut | undefined, meta: MetaOut, threadId: string) {
  const { orgId, call } = useMailApi();
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useShareToChat();
  const id = threadId;
  const targets = useQuery({ queryKey: mailKey(orgId, "link-targets"), queryFn: () => call<LinkTargetsOut>("link-targets"), staleTime: 60_000 });
  const conns = useQuery({ queryKey: mailKey(orgId, "connections", id), queryFn: () => call<{ items: ConnectionOut[] }>(`threads/${id}/connections`) });
  const [open, setOpen] = useState<Open>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: mailKey(orgId, "connections", id) });
  const t = targets.data;
  const last = d?.messages[d.messages.length - 1];

  const shareChat = () => {
    if (!d) return;
    const first = d.messages.find((m) => m.from.address === d.sender.address) ?? d.messages[0];
    const excerpt = last ? writtenPart(last.text).replace(/\s+/g, " ").slice(0, 280) : "";
    chat.share(
      { kind: "mail", id, title: d.thread.subject || "(no subject)", sub: excerpt, link: `/mail/t/${id}`, module: "Email", fields: [{ label: "From", value: first ? `${personName(first.from)} <${first.from.address}>` : "" }, { label: "Received", value: last ? new Date(last.date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "" }, { label: "Messages", value: d.messages.length }, { label: "Attachments", value: d.messages.flatMap((m) => m.attachments).map((a) => a.filename).join(", ") || null }] },
      {
        onShared: (r) => void call(`threads/${id}/chat`, "POST", { messageId: r.messageId, channelId: r.channelId, where: r.where }).then(refresh).catch((e) => toast({ tone: "error", title: errorMessage(e) })),
      },
    );
  };

  const items: MenuItem[] = [
    { label: "Save to Notes…", icon: <NotebookPen />, onSelect: () => setOpen({ kind: "note" }) },
    ...(t?.calendars ? [{ label: "Add to calendar…", icon: <CalendarPlus />, onSelect: () => setOpen({ kind: "event" }) } as MenuItem, { label: "Block time to deal with it…", icon: <CalendarPlus />, onSelect: () => setOpen({ kind: "event", focus: true }) } as MenuItem] : []),
    ...(t?.projects ? [{ label: "Make a task…", icon: <ListChecks />, onSelect: () => setOpen({ kind: "task" }) } as MenuItem] : []),
    ...(chat.available ? [{ label: "Share in Chat…", icon: <MessagesSquare />, onSelect: shareChat } as MenuItem] : []),
  ];

  const menu = <Menu label="Send this email to…" trigger={(p) => <button {...p} type="button" title="Send to Notes, Calendar, Tasks, Chat" aria-label="Send to Notes, Calendar, Tasks or Chat" className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"><Share2 className="size-4" /><span className="hidden @lg/bar:inline">Send to</span></button>} items={items} />;

  const dialogs = d && (
    <>
      {open?.kind === "note" && <NoteDialog d={d} messageId={open.messageId} ai={!!t?.ai} onClose={() => setOpen(null)} onDone={refresh} />}
      {open?.kind === "event" && t?.calendars && <EventDialog d={d} meta={meta} focus={!!open.focus} calendars={t.calendars} onClose={() => setOpen(null)} onDone={refresh} />}
      {open?.kind === "task" && t?.projects && <TaskDialog d={d} meta={meta} projects={t.projects} onClose={() => setOpen(null)} onDone={refresh} />}
    </>
  );

  const unlink = async (c: ConnectionOut) => {
    if (!c.id) return;
    try {
      await call(`threads/${id}/links/${c.id}`, "DELETE");
      refresh();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };

  const panel = (className?: string) => (
    <Connected
      className={className}
      items={conns.data?.items ?? []}
      loading={conns.isLoading}
      onUnlink={(c) => void unlink(c)}
      actions={[
        { kind: "note" as const, label: "Note", on: () => setOpen({ kind: "note" }) },
        ...(t?.calendars ? [{ kind: "event" as const, label: "Calendar", on: () => setOpen({ kind: "event" }) }] : []),
        ...(t?.projects ? [{ kind: "task" as const, label: "Task", on: () => setOpen({ kind: "task" }) }] : []),
        ...(chat.available ? [{ kind: "chat" as const, label: "Chat", on: shareChat }] : []),
      ]}
    />
  );

  return { menu, dialogs, panel, open: setOpen, saveMessage: (m: MessageOut) => setOpen({ kind: "note", messageId: m.id }), count: conns.data?.items.length ?? 0 };
}

// ── "Connected" ─────────────────────────────────────────────────────────────

function Connected({ items, loading, actions, onUnlink, className }: { items: ConnectionOut[]; loading: boolean; actions: { kind: Kind; label: string; on: () => void }[]; onUnlink: (c: ConnectionOut) => void; className?: string }) {
  return (
    <section className={cx("rounded-[16px] border border-border bg-surface p-3", className)} aria-label="Connected">
      <p className="flex items-center gap-1.5 px-1 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Connected{items.length > 0 && <span className="rounded-full bg-surface-2 px-1.5 text-[10.5px] text-fg tabular-nums">{items.length}</span>}</p>
      {loading ? null : items.length ? (
        <ul className="mt-2 grid gap-1">
          {items.map((c) => (
            <li key={`${c.kind}-${c.targetId}`} className="group flex items-center gap-2.5 rounded-[11px] px-1.5 py-1.5 transition-colors hover:bg-surface-2">
              <span className={cx("grid size-7 shrink-0 place-items-center rounded-[9px] [&>svg]:size-3.5", KIND[c.kind].tone)}>{KIND[c.kind].icon}</span>
              <Link href={c.href} className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{c.title}</span>
                <span className="block truncate text-[11.5px] text-muted">{KIND[c.kind].label} · {c.sub}{c.by ? ` · ${c.by}` : ""}</span>
              </Link>
              {c.id && <button type="button" aria-label={`Disconnect ${c.title}`} title="Disconnect from this email (it stays where it is)" onClick={() => onUnlink(c)} className="grid size-6 shrink-0 place-items-center rounded-full text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-3 hover:text-fg focus:opacity-100 [@media(hover:none)]:opacity-100"><Unlink className="size-3" /></button>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 px-1 text-[12px] text-muted">Turn this email into a note, an event, a task or a chat message — it shows here, and links back.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {actions.map((a) => (
          <button key={a.kind} type="button" onClick={a.on} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-[var(--surface-solid)] px-2.5 text-[12px] font-medium transition-colors hover:border-fg/25 hover:bg-surface-2 [&>svg]:size-3.5">
            {KIND[a.kind].icon}+ {a.label}
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Notes ───────────────────────────────────────────────────────────────────

type NoteHit = { id: string; title: string; snippet: string; updatedAt: string; mine: boolean };

function NoteDialog({ d, messageId, ai, onClose, onDone }: { d: ThreadOut; messageId?: string; ai: boolean; onClose: () => void; onDone: () => void }) {
  const { org } = useSession();
  const { call } = useMailApi();
  const toast = useToast();
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "append">("new");
  const [what, setWhat] = useState<"all" | "latest" | "message" | "summary">(messageId ? "message" : d.messages.length > 1 ? "all" : "latest");
  const [title, setTitle] = useState(d.thread.subject || "Email");
  const [tags, setTags] = useState("");
  const [comment, setComment] = useState("");
  const [attachments, setAttachments] = useState(true);
  const [remind, setRemind] = useState<"none" | "tomorrow" | "week">("none");
  const [after, setAfter] = useState(false);
  const [q, setQ] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const found = useQuery({ queryKey: ["notes", org.id, "pick", q], queryFn: () => api<{ notes: NoteHit[] }>(`/api/v1/orgs/${org.id}/notes?view=all&q=${encodeURIComponent(q)}`), enabled: mode === "append", staleTime: 10_000 });
  const files = d.messages.flatMap((m) => m.attachments).length;
  const msg = messageId ? d.messages.find((m) => m.id === messageId) : null;
  const remindAt = () => {
    if (remind === "none") return null;
    const x = new Date();
    x.setDate(x.getDate() + (remind === "tomorrow" ? 1 : ((8 - x.getDay()) % 7 || 7)));
    x.setHours(9, 0, 0, 0);
    return x.toISOString();
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await call<{ note: { id: string; title: string } }>(`threads/${d.thread.id}/note`, "POST", { mode, noteId: noteId ?? undefined, what, messageId, title, tags: tags.split(",").map((x) => x.trim()).filter(Boolean), comment, attachments, remindAt: mode === "new" ? remindAt() : null });
      toast({ tone: "success", title: mode === "new" ? "Saved to Notes" : `Added to “${r.note.title || "Untitled"}”`, description: "It's under Connected on this email, and links back here." });
      onDone();
      onClose();
      if (after) router.push(`/notes/${r.note.id}`);
    } catch (e) {
      toast({ tone: "error", title: e instanceof ApiClientError && /AI|provider/i.test(e.message) ? "AI isn't connected — pick another option" : errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" title="Save to Notes" description={d.thread.subject || "(no subject)"} footer={<><label className="mr-auto flex items-center gap-2 text-[12.5px]"><Switch label="Open the note after" checked={after} onChange={setAfter} />Open it after</label><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={mode === "append" && !noteId} icon={<NotebookPen className="size-4" />} onClick={() => void save()}>{mode === "new" ? "Save note" : "Add to note"}</Button></>}>
      <div className="grid gap-4">
        <Segmented label="Where" value={mode} onChange={setMode} options={[{ value: "new", label: "A new note" }, { value: "append", label: "Add to a note I have" }]} />
        {mode === "append" ? (
          <div className="grid gap-2">
            <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" /><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a note" aria-label="Find a note" className="pl-8" /></div>
            <ul className="max-h-52 overflow-y-auto rounded-[12px] border border-border p-1">
              {(found.data?.notes ?? []).slice(0, 30).map((n) => (
                <li key={n.id}><button type="button" onClick={() => setNoteId(n.id)} className={cx("flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2", noteId === n.id && "bg-accent/10")}><NotebookPen className="size-3.5 shrink-0 text-muted" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{n.title || "Untitled"}</span><span className="block truncate text-[11.5px] text-muted">{n.snippet || "Empty"}</span></span>{noteId === n.id && <Check className="size-4 text-accent" />}</button></li>
              ))}
              {found.data && !found.data.notes.length && <li className="p-3 text-center text-[12.5px] text-muted">No notes match</li>}
            </ul>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Title">{(p) => <Input {...p} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <Field label="Tags">{(p) => <Input {...p} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="client, launch" />}</Field>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-[13px] font-medium">What to keep</p>
          <div className="grid gap-1.5">
            {msg && <Choice on={what === "message"} set={() => setWhat("message")} title="This message" sub={`${personName(msg.from)} · ${new Date(msg.date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`} />}
            <Choice on={what === "all"} set={() => setWhat("all")} title="The whole conversation" sub={`${d.messages.length} message${d.messages.length === 1 ? "" : "s"} — what was written, without quoted history or signatures`} />
            <Choice on={what === "latest"} set={() => setWhat("latest")} title="Just the latest message" />
            <Choice on={what === "summary"} set={() => setWhat("summary")} disabled={!ai} title={<span className="inline-flex items-center gap-1"><Sparkles className="size-3.5 text-violet-500" />AI summary and to-dos</span>} sub={ai ? "A short summary, and what needs doing as a checklist" : "Needs an AI provider (Settings → AI providers)"} />
          </div>
        </div>
        <Field label="Your note (optional)">{(p) => <Textarea {...p} rows={2} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder="Why it matters, what to do next…" />}</Field>
        <div className="grid gap-2.5">
          {files > 0 && <label className="flex items-center gap-2.5 text-[13px]"><Switch label="Attachments" checked={attachments} onChange={setAttachments} />Link its {files} attachment{files === 1 ? "" : "s"}</label>}
          {mode === "new" && (
            <label className="flex items-center gap-2.5 text-[13px]">
              <span className="whitespace-nowrap text-muted">Remind me</span>
              <Select aria-label="Remind me" value={remind} onChange={(e) => setRemind(e.target.value as typeof remind)} className="h-8 w-auto text-[12.5px]"><option value="none">No reminder</option><option value="tomorrow">Tomorrow 9 am</option><option value="week">Next Monday 9 am</option></Select>
            </label>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Choice({ on, set, title, sub, disabled }: { on: boolean; set: () => void; title: ReactNode; sub?: string; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={set} className={cx("flex items-start gap-2.5 rounded-[12px] border px-3 py-2 text-left transition-colors disabled:opacity-50", on ? "border-accent bg-accent/[0.06]" : "border-border hover:bg-surface-2")}>
      <span className={cx("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-accent bg-accent text-accent-fg" : "border-fg/30")}>{on && <span className="size-1.5 rounded-full bg-current" />}</span>
      <span><span className="block text-[13px] font-medium">{title}</span>{sub && <span className="block text-[11.5px] text-muted">{sub}</span>}</span>
    </button>
  );
}

// ── Calendar ────────────────────────────────────────────────────────────────

function EventDialog({ d, meta, focus, calendars, onClose, onDone }: { d: ThreadOut; meta: MetaOut; focus: boolean; calendars: NonNullable<LinkTargetsOut["calendars"]>; onClose: () => void; onDone: () => void }) {
  const { call } = useMailApi();
  const toast = useToast();
  const router = useRouter();
  // The moment the dialog opened: "upcoming" is from here.
  const [now] = useState(() => Date.now());
  // Who it's with: everyone on the conversation but you.
  const people = useMemo(() => {
    const mine = new Set(meta.accounts.map((a) => a.address.toLowerCase()));
    const seen = new Map<string, string>();
    for (const m of d.messages) for (const p of [m.from, ...m.to, ...m.cc]) if (!mine.has(p.address.toLowerCase()) && !seen.has(p.address.toLowerCase())) seen.set(p.address.toLowerCase(), p.name);
    return [...seen].map(([email, name]) => ({ email, name }));
  }, [d.messages, meta.accounts]);
  // A time and a link from the email itself, when it has them.
  const found = useMemo(() => {
    for (const m of [...d.messages].reverse()) {
      const t = findMeetingTime(`${d.thread.subject}\n${m.text}`, Date.parse(m.date), tzOf());
      if (t && t.start > now) return t;
    }
    return null;
  }, [d, now]);
  const link = useMemo(() => findMeetingLink(d.messages.map((m) => m.text).join("\n")), [d.messages]);
  const [kind, setKind] = useState<"meeting" | "focus">(focus ? "focus" : "meeting");
  const [title, setTitle] = useState(focus ? `Reply: ${d.thread.subject || "email"}` : d.thread.subject || "Meeting");
  // From the email's own time; otherwise the next whole hour (tomorrow morning after 5 pm).
  const start0 = useMemo(() => {
    if (found && !focus) return new Date(found.start);
    const x = new Date(now);
    x.setMinutes(0, 0, 0);
    x.setHours(x.getHours() + (x.getHours() >= 17 ? 16 : 1));
    return x;
  }, [found, focus, now]);
  const [date, setDate] = useState(localDate(start0));
  const [time, setTime] = useState(localTime(start0));
  const [mins, setMins] = useState(found?.end && !focus ? Math.max(15, Math.round((found.end - found.start) / 60_000)) : focus ? 30 : 30);
  const [chosen, setChosen] = useState<string[]>(focus ? [] : people.map((p) => p.email));
  const [meetingUrl, setMeetingUrl] = useState(link?.url ?? "");
  const [invite, setInvite] = useState(false);
  const [calendarId, setCalendarId] = useState(calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? "");
  const [reminder, setReminder] = useState(10);
  const [after, setAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const meeting = kind === "meeting";
  const save = async () => {
    setBusy(true);
    try {
      const start = new Date(`${date}T${time}`);
      const r = await call<{ event: { id: string } }>(`threads/${d.thread.id}/event`, "POST", { kind, title, start: start.toISOString(), end: new Date(start.getTime() + mins * 60_000).toISOString(), tz: tzOf(), calendarId, attendees: meeting ? people.filter((p) => chosen.includes(p.email)).map((p) => ({ name: p.name, email: p.email })) : [], meetingUrl: meeting ? meetingUrl : "", invite: meeting && invite, reminders: [reminder] });
      toast({ tone: "success", title: meeting ? (invite ? "In your calendar — invite sent" : "In your calendar") : "Time blocked in your calendar", description: "Open it from Connected; the event links back to this email." });
      onDone();
      onClose();
      if (after) router.push(`/calendar?event=${r.event.id}`);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" title={meeting ? "Add to calendar" : "Block time to deal with it"} description={d.thread.subject || "(no subject)"} footer={<><label className="mr-auto flex items-center gap-2 text-[12.5px]"><Switch label="Open the calendar after" checked={after} onChange={setAfter} />Open it after</label><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} icon={<CalendarPlus className="size-4" />} onClick={() => void save()}>{meeting && invite ? "Add and send invite" : "Add to calendar"}</Button></>}>
      <div className="grid gap-4">
        <Segmented label="Kind" value={kind} onChange={(k) => { setKind(k); setTitle(k === "focus" ? `Reply: ${d.thread.subject || "email"}` : d.thread.subject || "Meeting"); setChosen(k === "focus" ? [] : people.map((p) => p.email)); }} options={[{ value: "meeting", label: "A meeting" }, { value: "focus", label: "Time to deal with it" }]} />
        {meeting && found && <p className="flex items-center gap-2 rounded-[12px] bg-sky-500/8 px-3 py-2 text-[12.5px] text-sky-800 dark:text-sky-200"><Sparkles className="size-3.5 shrink-0" />Time read from the email: “{found.text}”{found.confidence !== "high" ? " — check it" : ""}.</p>}
        <Field label="Title">{(p) => <Input {...p} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <Field label="Date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Time">{(p) => <Input {...p} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-[120px]" />}</Field>
          <Field label="Length">{(p) => <Select {...p} value={mins} onChange={(e) => setMins(Number(e.target.value))}>{[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}</Select>}</Field>
        </div>
        {meeting && (
          <>
            {people.length > 0 && (
              <div>
                <p className="mb-1.5 text-[13px] font-medium">With</p>
                <div className="flex flex-wrap gap-1.5">
                  {people.map((p) => {
                    const on = chosen.includes(p.email);
                    return <button key={p.email} type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== p.email) : [...chosen, p.email])} className={cx("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12.5px] transition-colors", on ? "border-accent bg-accent/10 font-medium text-accent" : "border-border text-muted hover:bg-surface-2")}>{on && <Check className="size-3" />}{p.name || p.email}</button>;
                  })}
                </div>
              </div>
            )}
            <Field label={link ? `Video link (found a ${providerName(link.provider) || "meeting"} link)` : "Video link (optional)"}>{(p) => <div className="relative"><Video className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" /><Input {...p} value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://…" className="pl-8" /></div>}</Field>
            {chosen.length > 0 && <label className="flex items-start gap-2.5 text-[13px]"><Switch label="Send invite" checked={invite} onChange={setInvite} /><span><span className="block font-medium">Email them an invite</span><span className="block text-[11.5px] text-muted">From your mailbox, with Accept / Decline — it lands in their calendars.</span></span></label>}
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Calendar">{(p) => <Select {...p} value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>{calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Remind me">{(p) => <Select {...p} value={reminder} onChange={(e) => setReminder(Number(e.target.value))}>{[0, 5, 10, 15, 30, 60, 1440].map((r) => <option key={r} value={r}>{r === 0 ? "As it starts" : r === 1440 ? "A day before" : `${r} min before`}</option>)}</Select>}</Field>
        </div>
      </div>
    </Dialog>
  );
}

// ── Projects ────────────────────────────────────────────────────────────────

function TaskDialog({ d, meta, projects, onClose, onDone }: { d: ThreadOut; meta: MetaOut; projects: NonNullable<LinkTargetsOut["projects"]>; onClose: () => void; onDone: () => void }) {
  const { call } = useMailApi();
  const toast = useToast();
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState(d.thread.subject ? `Reply: ${d.thread.subject}` : "Follow up on email");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(meta.me.id);
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [includeEmail, setIncludeEmail] = useState(true);
  const [after, setAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await call<{ task: { id: string; number: number } }>(`threads/${d.thread.id}/task`, "POST", { projectId, title, dueDate: dueDate || null, assigneeId: assigneeId || null, priority, includeEmail });
      toast({ tone: "success", title: `Task #${r.task.number} made`, description: "It's under Connected, and the task links back to this email." });
      onDone();
      onClose();
      if (after) router.push(`/work/tasks/${r.task.id}`);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" title="Make a task" description={d.thread.subject || "(no subject)"} footer={<><label className="mr-auto flex items-center gap-2 text-[12.5px]"><Switch label="Open the task after" checked={after} onChange={setAfter} />Open it after</label><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!projectId} icon={<ListChecks className="size-4" />} onClick={() => void save()}>Make task</Button></>}>
      <div className="grid gap-4">
        <Field label="Task">{(p) => <Input {...p} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project">{(p) => <Select {...p} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((x) => <option key={x.id} value={x.id}>{x.code ? `${x.code} · ` : ""}{x.name}</option>)}</Select>}</Field>
          <Field label="Who does it">{(p) => <Select {...p} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}><option value="">Nobody yet</option>{meta.members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}{m.id === meta.me.id ? " (me)" : ""}</option>)}</Select>}</Field>
          <Field label="Due">{(p) => <Input {...p} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
          <Field label="Priority">{(p) => <Select {...p} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select>}</Field>
        </div>
        <label className="flex items-start gap-2.5 text-[13px]"><Switch label="Include the email" checked={includeEmail} onChange={setIncludeEmail} /><span><span className="block font-medium">Put the email in the task</span><span className="block text-[11.5px] text-muted">Who sent it, when, what it says, and a link back.</span></span></label>
      </div>
    </Dialog>
  );
}
