"use client";

// One conversation: actions (archive, snooze, follow-up, labels, category,
// assign, screener, unsubscribe), warnings about fake senders, the AI panel,
// every message (HTML in a locked-down frame, attachments, scheduled/sending
// states), internal notes for team inboxes, the CRM contact, and the reply box.
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Archive, ArrowLeft, Bell, BellOff, BellRing, BookUser, ChevronDown, Clock, Crown, Download, FileText, Forward, Image as ImageIcon, Inbox, Info, ListChecks, Loader2, Mail, MailOpen, MessageSquareText, MoreHorizontal, Paperclip, Pin, Printer, Reply, ReplyAll, ShieldAlert, ShieldCheck, ShieldOff, Sparkles, Star, Tag, Ticket, Trash2, UserPlus, UserRound, Maximize2, NotebookPen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Menu, useToast, type MenuItem } from "@/components/ui/overlays";
import { Badge, Button, IconButton, Input, Notice, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import type { AiOut, MessageDetails, MessageOut, MetaOut, ThreadOut, ThreadPatch } from "@/lib/mail/api";
import { CATEGORIES, CATEGORY_LABEL, REPLY_CATEGORIES, slaState, type Category } from "@/lib/mail/model";
import { fmtMinutes } from "./analytics";
import { ContactEditor } from "./contacts";
import { MeetingCard } from "./meeting-card";
import { Composer, type ComposeMode } from "./compose";
import { SaveToDocuments } from "@/components/documents/picker";
import { accountOf, Avatar, fileSize, longTime, mailKey, personName, presets, useMailApi, useMailRefresh, useUndoSend } from "./shared";
import { useMailLinks } from "./links";

export type ThreadActions = { patch: (id: string, p: ThreadPatch, done?: string) => void; openCompose: (mode: ComposeMode) => void };

function SnoozeMenu({ onPick, label = "Snooze", icon = <AlarmClock className="size-4" />, custom }: { onPick: (iso: string | null) => void; label?: string; icon?: React.ReactNode; custom: () => void }) {
  return (
    <Menu
      label={label}
      trigger={(p) => <IconButton {...p} label={label} icon={icon} />}
      items={[...presets().map((x) => ({ label: `${x.label} · ${x.at.toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })}`, onSelect: () => onPick(x.at.toISOString()) })), { label: "Pick a date and time…", onSelect: custom }]}
    />
  );
}

export function ThreadView({ id, meta, onBack, onClosed, replyRequest, noteRequest, fullscreen, onFullscreen, zoom = 1 }: { id: string; meta: MetaOut; onBack: () => void; onClosed: () => void; replyRequest: { mode: ComposeMode; n: number; id: string } | null; noteRequest?: { n: number; id: string } | null; fullscreen?: boolean; onFullscreen?: () => void; zoom?: number }) {
  const { orgId, base, call } = useMailApi();
  const toast = useToast();
  const refresh = useMailRefresh();
  const undo = useUndoSend();
  const q = useQuery({ queryKey: mailKey(orgId, "thread", id), queryFn: () => call<ThreadOut>(`threads/${id}`) });
  const [compose, setCompose] = useState<{ mode: ComposeMode; msg: MessageOut | null; prefill?: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [images, setImages] = useState<Set<string>>(new Set());
  const [ai, setAi] = useState<{ busy: string | null; out: AiOut | null; error: string | null }>({ busy: null, out: null, error: null });
  const [note, setNote] = useState("");
  const [pickTime, setPickTime] = useState<"snooze" | "follow" | null>(null);
  const [pickAt, setPickAt] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelText, setLabelText] = useState("");
  const [why, setWhy] = useState(false);
  // Notes, calendar, tasks and chat — and what this email is already connected to.
  const links = useMailLinks(q.data, meta, id);

  // Opening a conversation marks it read.
  const t = q.data?.thread;
  useEffect(() => {
    if (t && t.unread > 0) void call(`threads/${id}`, "PATCH", { read: true }).then(() => refresh()).catch(() => {});
  }, [t, id, call, refresh]);

  // Keyboard r / a / f from the list.
  const lastMsg = q.data?.messages[q.data.messages.length - 1] ?? null;
  const lastIn = useMemo(() => [...(q.data?.messages ?? [])].reverse().find((m) => m.sendStatus === null || m.sendStatus === "sent") ?? null, [q.data]);
  const [handled, setHandled] = useState<number | null>(null);
  if (replyRequest && replyRequest.id === id && q.data && replyRequest.n !== handled) {
    setHandled(replyRequest.n);
    setCompose({ mode: replyRequest.mode, msg: lastIn });
  }
  // "n" from the list: save it to Notes.
  const [noted, setNoted] = useState<number | null>(null);
  if (noteRequest && noteRequest.id === id && q.data && noteRequest.n !== noted) {
    setNoted(noteRequest.n);
    links.open({ kind: "note" });
  }

  if (q.isError) return <div className="grid h-full place-items-center p-8"><Notice tone="danger" title="Couldn't open this conversation">{errorMessage(q.error)}</Notice></div>;
  if (!q.data || !t) return <div className="grid gap-3 p-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  const d = q.data;
  const account = accountOf(meta.accounts, t.accountId);
  const shared = !!account?.shared;

  const patch = async (p: ThreadPatch, done?: string, close = false) => {
    try {
      await call(`threads/${id}`, "PATCH", p);
      if (done) toast({ tone: "success", title: done });
      void refresh();
      if (close) onClosed();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const runAi = async (kind: "summary" | "reply" | "actions", tone?: "friendly" | "formal" | "short") => {
    setAi({ busy: kind, out: ai.out, error: null });
    try {
      const out = await call<AiOut>(`threads/${id}/ai`, "POST", { kind, tone });
      setAi({ busy: null, out: { ...ai.out, ...out }, error: null });
      if (kind === "reply" && out.draft) setCompose({ mode: "reply", msg: lastIn, prefill: out.draft });
    } catch (e) {
      setAi({ busy: null, out: ai.out, error: e instanceof ApiClientError && e.code === "provider_not_configured" ? "AI isn't connected for this workspace. An owner can add a provider in Settings → AI providers. Sorting, screener, rules and reminders work without it." : errorMessage(e) });
    }
  };
  const verdict = async (v: "allowed" | "blocked" | "vip" | null, done: string) => {
    try {
      await call("senders", "POST", { accountId: t.accountId, address: d.sender.address, verdict: v });
      toast({ tone: "success", title: done });
      void refresh();
      if (v === "blocked") onClosed();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const link = async (kind: "contact" | "ticket") => {
    try {
      await call(`threads/${id}/link`, "POST", { kind });
      toast({ tone: "success", title: kind === "contact" ? "Added to CRM" : "Helpdesk ticket created" });
      void refresh();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const unsubscribe = async () => {
    try {
      const r = await call<{ ok: boolean; via: string; url?: string }>(`threads/${id}/unsubscribe`, "POST");
      if (r.via === "link" && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
      toast({ tone: "success", title: r.via === "link" ? "Opened the sender's unsubscribe page" : "Unsubscribed", description: r.via === "mailto" ? "We emailed the sender's unsubscribe address for you." : undefined });
      void refresh();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await call(`threads/${id}/notes`, "POST", { body: note.trim() });
      setNote("");
      void q.refetch();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const cancelSend = async (m: MessageOut) => {
    try {
      await call(`messages/${m.id}/cancel`, "POST");
      toast({ tone: "success", title: "Cancelled" });
      void refresh();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  void undo;
  const unsub = d.messages.find((m) => m.unsubscribe)?.unsubscribe ?? null;
  // The latest meeting in the conversation (an update replaces the first invite).
  const meetingMsg = [...d.messages].reverse().find((m) => m.meeting) ?? null;
  const more: MenuItem[] = [
    { label: t.pinned ? "Unpin" : "Pin to top", icon: <Pin />, onSelect: () => void patch({ pinned: !t.pinned }) },
    { label: t.muted ? "Unmute" : "Mute — new replies skip the inbox", icon: t.muted ? <Bell /> : <BellOff />, onSelect: () => void patch({ muted: !t.muted }, t.muted ? "Unmuted — back in your inbox" : "Muted", !t.muted) },
    { label: "Print", icon: <Printer />, onSelect: () => window.open(`/mail/print/${id}`, "_blank", "noopener") },
    { label: "Mark as unread", icon: <Mail />, onSelect: () => void patch({ read: false }, "Marked unread", true) },
    { label: "Remind me if no reply in 2 days", icon: <BellRing />, onSelect: () => void patch({ followUpAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }, "We'll remind you") },
    { label: "Remind me if no reply on…", icon: <BellRing />, onSelect: () => setPickTime("follow") },
    ...(t.followUpAt ? [{ label: "Cancel the reminder", icon: <BellRing />, onSelect: () => void patch({ followUpAt: null }, "Reminder cancelled") } as MenuItem] : []),
    "separator",
    { label: t.status === "spam" ? "Not spam" : "Report spam", icon: <ShieldAlert />, onSelect: () => void patch({ status: t.status === "spam" ? "inbox" : "spam" }, t.status === "spam" ? "Moved to inbox" : "Moved to spam", t.status !== "spam") },
    { label: `Block ${d.sender.address}`, icon: <ShieldOff />, danger: true, onSelect: () => void verdict("blocked", "Sender blocked — their mail goes to trash") },
  ];

  const owed = t.awaitingSince && !t.muted && REPLY_CATEGORIES.includes(t.category) ? slaState(t.awaitingSince, account?.settings.slaHours ?? null) : null;
  const senderName = d.contact?.name ?? personName({ name: d.messages.find((m) => m.from.address === d.sender.address)?.from.name ?? "", address: d.sender.address });
  const vip = d.sender.verdict === "vip";
  const sender = { name: senderName, address: d.sender.address, vip, contact: d.contact, ticketId: t.ticketId, crm: meta.links.crm, helpdesk: meta.links.helpdesk, onLink: (k: "contact" | "ticket") => void link(k), onVip: () => void verdict(vip ? null : "vip", vip ? "No longer VIP" : "Marked VIP — always Important") };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Action bar */}
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-border px-2 @container/bar sm:px-3">
        {!fullscreen && <IconButton label="Back to list" className="@3xl/mail:hidden" icon={<ArrowLeft className="size-4" />} onClick={onBack} />}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          <IconButton label={t.status === "archived" ? "Move to inbox (e)" : "Archive (e)"} icon={t.status === "archived" ? <Inbox className="size-4" /> : <Archive className="size-4" />} onClick={() => void patch({ status: t.status === "archived" ? "inbox" : "archived" }, t.status === "archived" ? "Moved to inbox" : "Archived", true)} />
          <IconButton label="Move to trash (#)" icon={<Trash2 className="size-4" />} onClick={() => void patch({ status: "trash" }, "Moved to trash", true)} />
          <SnoozeMenu onPick={(iso) => void patch({ snoozeUntil: iso }, "Snoozed", true)} custom={() => setPickTime("snooze")} />
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
          <IconButton label={t.starred ? "Unstar (s)" : "Star (s)"} icon={<Star className={cx("size-4", t.starred && "fill-amber-400 text-amber-400")} />} onClick={() => void patch({ starred: !t.starred })} />
          <IconButton label="Labels (l)" icon={<Tag className="size-4" />} onClick={() => setLabelOpen(true)} />
          <Menu label="Move to category" trigger={(p) => <IconButton {...p} label="Move to category" icon={<ListChecks className="size-4" />} />} items={CATEGORIES.map((c) => ({ label: `${c === t.category ? "✓ " : ""}${CATEGORY_LABEL[c]}`, onSelect: () => void patch({ category: c as Category }, `Moved to ${CATEGORY_LABEL[c]}`) }))} />
          {shared && (
            <Menu
              label="Assign"
              trigger={(p) => <IconButton {...p} label="Assign" icon={<UserRound className="size-4" />} />}
              items={[{ label: "Unassigned", onSelect: () => void patch({ assigneeId: null }, "Unassigned") }, ...meta.members.filter((m) => !account || account.members.includes(m.id) || m.id === account.ownerId).map((m) => ({ label: `${m.id === t.assigneeId ? "✓ " : ""}${m.name || m.email}${m.id === meta.me.id ? " (me)" : ""}`, onSelect: () => void patch({ assigneeId: m.id }, `Assigned to ${m.name || m.email}`) }))]}
            />
          )}
          <Menu label="More" trigger={(p) => <IconButton {...p} label="More" icon={<MoreHorizontal className="size-4" />} />} items={more} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pl-1">
          {links.menu}
          <IconButton label="Reply (r)" icon={<Reply className="size-4" />} onClick={() => setCompose({ mode: "reply", msg: lastIn })} />
          <IconButton label="Forward (f)" className="hidden @md/bar:inline-flex" icon={<Forward className="size-4" />} onClick={() => setCompose({ mode: "forward", msg: lastIn })} />
          {onFullscreen && !fullscreen && <IconButton label="Full screen (v)" icon={<Maximize2 className="size-4" />} onClick={onFullscreen} />}
        </div>
      </div>

      <div className="@container/thread min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth">
        {/* Text size (full screen): the whole conversation scales, emails included. */}
        <div style={zoom !== 1 ? { zoom } : undefined} className={cx("mx-auto grid max-w-[1040px] gap-6 px-4 pt-5 pb-10 @xl/thread:px-6 @2xl/thread:px-8 @2xl/thread:pt-7 @4xl/thread:grid-cols-[minmax(0,1fr)_256px]", fullscreen && "max-w-[1120px] pb-24 @2xl/thread:pt-10")}>
          <div className="min-w-0">
            {/* Heading */}
            <h2 className="text-[20px] leading-[1.25] font-semibold tracking-[-0.02em] break-words @2xl/thread:text-[23px]">{t.subject || "(no subject)"}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px]">
              <button type="button" onClick={() => setWhy(!why)} className="inline-flex h-6 items-center gap-1 rounded-full bg-surface-2 px-2.5 font-medium transition-colors hover:bg-fg/10" aria-expanded={why} title="Why it's here">
                {CATEGORY_LABEL[t.category]} <Info className="size-3 text-muted" />
              </button>
              {t.priority === "high" && <Badge tone="danger">Important</Badge>}
              {owed && <Badge tone={owed.overdue ? "danger" : "warning"}><Clock className="size-3" /> {owed.overdue ? `Overdue — waiting ${fmtMinutes(owed.waitingMs / 60_000)}` : `Waiting ${fmtMinutes(owed.waitingMs / 60_000)}${owed.dueAt ? ` · reply by ${new Date(owed.dueAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : ""}`}</Badge>}
              {t.muted && <Badge><BellOff className="size-3" /> Muted</Badge>}
              {account && <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5"><span className="size-2 rounded-full" style={{ background: account.color }} />{account.name}</span>}
              {t.labels.map((l) => <Badge key={l} tone="accent">{l}</Badge>)}
              {t.snoozeUntil && <Badge tone="warning">Snoozed until {longTime(t.snoozeUntil)}</Badge>}
              {t.followUpAt && <Badge tone="warning">Reminder {new Date(t.followUpAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} if no reply</Badge>}
              {t.assigneeId && <Badge>Assigned to {meta.members.find((m) => m.id === t.assigneeId)?.name ?? "someone"}</Badge>}
            </div>
            {why && (
              <div className="mt-3 rounded-[14px] bg-surface-2 px-4 py-3 text-[12.5px]">
                <p className="font-semibold">Why it&apos;s in {CATEGORY_LABEL[t.category]}</p>
                {t.reasons.length ? <ul className="mt-1 list-disc pl-4 text-muted">{t.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="mt-0.5 text-muted">No special signals — it&apos;s regular mail.</p>}
                <p className="mt-1.5 text-muted">Wrong? Move it with the category button; a rule can make it stick.</p>
              </div>
            )}

            {/* Who it's from — a compact strip here; a side card when the pane is wide. */}
            <SenderPanel {...sender} className="mt-4 @4xl/thread:hidden" />
            {links.panel("mt-3 @4xl/thread:hidden")}

            {meetingMsg?.meeting && <MeetingCard messageId={meetingMsg.id} meeting={meetingMsg.meeting} eventId={t.meetingEventId} />}

            {t.warnings.length > 0 && (
              <div className="mt-4 flex gap-3 rounded-[16px] border border-danger/25 bg-danger-soft px-4 py-3.5 text-[13px] text-danger">
                <ShieldAlert className="mt-0.5 size-[18px] shrink-0" />
                <div>
                  <p className="font-semibold">Be careful with this email</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">{t.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  <p className="mt-1.5 text-[12px] opacity-80">Don&apos;t open links or attachments or share passwords unless you&apos;re sure who sent it.</p>
                </div>
              </div>
            )}

            {t.category === "screener" && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[16px] border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[13px]">
                <ShieldCheck className="size-[18px] shrink-0 text-amber-600" />
                <span className="min-w-[180px] flex-1">First email from <b className="font-semibold">{d.sender.address}</b>. Let them into your inbox?</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void verdict("allowed", "Allowed — their mail comes to your inbox")}>Allow</Button>
                  <Button size="sm" icon={<ShieldOff className="size-3.5" />} onClick={() => void verdict("blocked", "Blocked")}>Block</Button>
                </div>
              </div>
            )}

            {unsub && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[14px] bg-surface-2 px-4 py-2.5 text-[12.5px] text-muted">
                <MailOpen className="size-4 shrink-0" />
                <span className="flex-1">This comes from a mailing list.</span>
                <button type="button" onClick={() => void unsubscribe()} className="font-semibold text-fg hover:underline">Unsubscribe</button>
              </div>
            )}

            {/* AI */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-muted"><Sparkles className="size-3.5 text-violet-500" /> AI</span>
              <AiChip busy={ai.busy === "summary"} onClick={() => void runAi("summary")}>Summarise</AiChip>
              <Menu label="Suggest a reply" align="start" trigger={(p) => <AiChip {...p} busy={ai.busy === "reply"}>Suggest a reply <ChevronDown className="size-3" /></AiChip>} items={(["friendly", "formal", "short"] as const).map((tone) => ({ label: tone === "short" ? "Short and direct" : `${tone[0]!.toUpperCase()}${tone.slice(1)}`, onSelect: () => void runAi("reply", tone) }))} />
              <AiChip busy={ai.busy === "actions"} onClick={() => void runAi("actions")}>To-dos &amp; dates</AiChip>
            </div>
            {(t.aiSummary || ai.out?.summary || ai.out?.actions || ai.error) && (
              <div className="mt-3 rounded-[16px] border border-violet-500/20 bg-violet-500/[0.05] px-4 py-3 text-[13.5px]">
                {(t.aiSummary || ai.out?.summary) && <p className="leading-relaxed whitespace-pre-line">{ai.out?.summary ?? t.aiSummary}</p>}
                {ai.out?.actions && (ai.out.actions.length ? <ul className="mt-2 grid gap-1.5 text-[13px]">{ai.out.actions.map((a, i) => <li key={i} className="flex items-start gap-2"><Badge>{a.kind}</Badge><span>{a.text}</span></li>)}</ul> : <p className="mt-1 text-[13px] text-muted">Nothing to act on in this conversation.</p>)}
                {ai.error && <p className="text-[12.5px] text-muted">{ai.error}</p>}
              </div>
            )}

            {/* Messages */}
            <div className="mt-5 grid gap-3">
              {d.messages.map((m, i) => {
                const open = i === d.messages.length - 1 || expanded.has(m.id) || d.messages.length <= 2;
                return open ? (
                  <MessageCard key={m.id} m={m} base={base} onNote={() => links.saveMessage(m)} images={images.has(m.id)} onImages={() => setImages(new Set([...images, m.id]))} onCollapse={d.messages.length > 2 && i < d.messages.length - 1 ? () => setExpanded(new Set([...expanded].filter((x) => x !== m.id))) : undefined} onReply={(mode) => setCompose({ mode, msg: m })} onCancel={() => void cancelSend(m)} />
                ) : (
                  <button key={m.id} type="button" onClick={() => setExpanded(new Set([...expanded, m.id]))} className="flex w-full items-center gap-3 rounded-[16px] border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2">
                    <Avatar p={m.from} size={28} />
                    <span className="w-28 shrink-0 truncate text-[13px] font-medium @lg/thread:w-40">{personName(m.from)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{m.text.replace(/\s+/g, " ").slice(0, 160)}</span>
                    <span className="shrink-0 text-[12px] text-subtle">{new Date(m.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  </button>
                );
              })}
            </div>

            {/* Team notes */}
            {shared && (
              <div className="mt-4 grid gap-2">
                {d.notes.map((n) => (
                  <div key={n.id} className="rounded-[16px] border border-amber-300/50 bg-amber-50 px-4 py-3 text-[13px] dark:bg-amber-500/10">
                    <p className="flex items-center gap-1.5 text-[12px] font-medium text-amber-800 dark:text-amber-300"><MessageSquareText className="size-3.5" /> {n.by ?? "Someone"} · {longTime(n.at)} · only your team sees this</p>
                    <p className="mt-1 whitespace-pre-line">{n.body}</p>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Textarea aria-label="Internal note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note — only your team sees it" className="!min-h-9" />
                  <Button disabled={!note.trim()} onClick={() => void addNote()}>Add note</Button>
                </div>
              </div>
            )}

            {/* Reply */}
            <div className="mt-4">
              {compose ? (
                <Composer key={`${compose.mode}-${compose.msg?.id ?? "x"}-${compose.prefill?.length ?? 0}`} mode={compose.mode} inline accounts={meta.accounts} thread={d} message={compose.msg} prefill={compose.prefill} draftKey={`${id}-${compose.mode}`} onClose={() => setCompose(null)} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" icon={<Reply className="size-4" />} onClick={() => setCompose({ mode: "reply", msg: lastIn })}>Reply</Button>
                  {lastMsg && lastMsg.to.length + lastMsg.cc.length > 1 && <Button icon={<ReplyAll className="size-4" />} onClick={() => setCompose({ mode: "replyAll", msg: lastIn })}>Reply all</Button>}
                  <Button icon={<Forward className="size-4" />} onClick={() => setCompose({ mode: "forward", msg: lastIn })}>Forward</Button>
                </div>
              )}
            </div>
          </div>

          <aside className="hidden @4xl/thread:block">
            <div className="sticky top-0 grid gap-3">
              <SenderPanel {...sender} card />
              {links.panel()}
            </div>
          </aside>
        </div>
      </div>

      {links.dialogs}
      {pickTime && (
        <Dialog open onClose={() => setPickTime(null)} size="sm" title={pickTime === "snooze" ? "Snooze until" : "Remind me if no reply by"} footer={<><Button onClick={() => setPickTime(null)}>Cancel</Button><Button variant="primary" disabled={!pickAt || new Date(pickAt) <= new Date()} onClick={() => { void patch(pickTime === "snooze" ? { snoozeUntil: new Date(pickAt).toISOString() } : { followUpAt: new Date(pickAt).toISOString() }, pickTime === "snooze" ? "Snoozed" : "We'll remind you", pickTime === "snooze"); setPickTime(null); }}>Set</Button></>}>
          <Input type="datetime-local" aria-label="Date and time" value={pickAt} onChange={(e) => setPickAt(e.target.value)} />
        </Dialog>
      )}
      {labelOpen && (
        <Dialog open onClose={() => setLabelOpen(false)} size="sm" title="Labels" footer={<Button variant="primary" onClick={() => setLabelOpen(false)}>Done</Button>}>
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...meta.labels, ...t.labels])].map((l) => {
                const on = t.labels.includes(l);
                return <button key={l} type="button" aria-pressed={on} onClick={() => void patch({ labels: on ? t.labels.filter((x) => x !== l) : [...t.labels, l] })} className={cx("h-7 rounded-full px-3 text-[12.5px] ring-1", on ? "bg-accent/10 text-accent ring-accent/40" : "ring-border hover:bg-surface-2")}>{on ? "✓ " : ""}{l}</button>;
              })}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const l = labelText.trim(); if (l && !t.labels.includes(l)) void patch({ labels: [...t.labels, l] }); setLabelText(""); }}>
              <Input aria-label="New label" placeholder="New label" value={labelText} onChange={(e) => setLabelText(e.target.value)} />
              <Button type="submit" disabled={!labelText.trim()}>Add</Button>
            </form>
          </div>
        </Dialog>
      )}
    </div>
  );
}

type SenderProps = { name: string; address: string; vip: boolean; contact: ThreadOut["contact"]; ticketId: string | null; crm: boolean; helpdesk: boolean; onLink: (k: "contact" | "ticket") => void; onVip: () => void };

/** Who sent it, and the business actions on them: a strip in the flow, or a side card. */
function SenderPanel({ name, address, vip, contact, ticketId, crm, helpdesk, onLink, onVip, card, className }: SenderProps & { card?: boolean; className?: string }) {
  const [saving, setSaving] = useState(false);
  const saveDialog = saving && <ContactEditor contact={null} groups={[]} initial={{ name: name === address ? "" : name, email: address, company: contact?.company ?? "" }} onClose={() => setSaving(false)} onSaved={() => setSaving(false)} />;
  const actions = (
    <>
      {contact ? (
        <a href={`/crm/contacts/${contact.id}`} className={pill}><UserRound className="size-3.5" /> Open in CRM</a>
      ) : crm ? (
        <button type="button" onClick={() => onLink("contact")} className={pill}><UserPlus className="size-3.5" /> Add to CRM</button>
      ) : null}
      {helpdesk && (ticketId ? <a href={`/helpdesk/tickets/${ticketId}`} className={pill}><Ticket className="size-3.5" /> Open ticket</a> : <button type="button" onClick={() => onLink("ticket")} className={pill}><Ticket className="size-3.5" /> Make a ticket</button>)}
      <button type="button" onClick={() => setSaving(true)} className={pill}><BookUser className="size-3.5" /> Save contact</button>
      <button type="button" aria-pressed={vip} onClick={onVip} className={cx(pill, vip && "border-amber-400/50 bg-amber-400/15 text-amber-800 dark:text-amber-300")}><Crown className="size-3.5" /> {vip ? "VIP" : "Mark VIP"}</button>
    </>
  );
  const deals = contact?.deals.length ? (
    <div className={cx("grid gap-1.5", card ? "mt-4" : "mt-3")}>
      {contact.deals.map((x) => <a key={x.id} href={`/crm/deals/${x.id}`} className="flex items-center justify-between gap-2 rounded-[10px] bg-surface-2 px-3 py-1.5 text-[12.5px] hover:bg-fg/10"><span className="truncate">{x.title}</span><span className="shrink-0 text-muted capitalize">{x.status}</span></a>)}
    </div>
  ) : null;
  if (card)
    return (
      <div className={cx("rounded-[18px] border border-border bg-surface p-4", className)}>
        <Avatar p={{ name, address }} size={44} />
        <p className="mt-3 truncate text-[14.5px] font-semibold">{name}</p>
        <p className="truncate text-[12.5px] text-muted">{address}</p>
        {contact?.company && <p className="mt-0.5 truncate text-[12.5px] text-muted">{contact.company}</p>}
        <div className="mt-4 flex flex-col items-stretch gap-1.5 [&>*]:justify-start">{actions}</div>
        {deals}
        {saveDialog}
      </div>
    );
  return (
    <div className={cx("rounded-[18px] border border-border bg-surface px-3.5 py-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex min-w-0 flex-1 basis-[200px] items-center gap-3">
          <Avatar p={{ name, address }} size={38} />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold">{name}</p>
            <p className="truncate text-[12px] text-muted">{address}{contact?.company ? ` · ${contact.company}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      </div>
      {deals}
      {saveDialog}
    </div>
  );
}
const pill = "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-[var(--surface-solid)] px-3 text-[12.5px] font-medium transition-colors hover:bg-surface-2";

function AiChip({ busy, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={busy || rest.disabled} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/[0.06] px-3 text-[12.5px] font-medium text-fg/85 transition-colors hover:bg-violet-500/[0.12] disabled:opacity-60", className)}>
      {busy && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

/**
 * An email's HTML in a locked-down frame that grows to fit it. The frame shares
 * our origin only so its height can be measured; scripts never run in it
 * (no allow-scripts here, and the response's own policy blocks them too).
 */
function EmailFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    const fit = () => {
      const body = f.contentDocument?.body;
      if (body) setH(Math.max(48, Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height)) + 2));
    };
    const onLoad = () => {
      const doc = f.contentDocument;
      if (!doc?.body) return;
      fit();
      ro?.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(fit);
        ro.observe(doc.body);
      }
      doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));
    };
    f.addEventListener("load", onLoad);
    if (f.contentDocument?.readyState === "complete" && f.contentDocument.URL !== "about:blank") onLoad();
    return () => {
      f.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [src]);
  return <iframe ref={ref} title={title} src={src} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" style={{ height: h }} className="block w-full rounded-[12px] bg-white" />;
}

function MessageCard({ m, base, images, onImages, onCollapse, onReply, onCancel, onNote }: { m: MessageOut; base: string; images: boolean; onImages: () => void; onCollapse?: () => void; onReply: (mode: ComposeMode) => void; onCancel: () => void; onNote: () => void }) {
  const [plain, setPlain] = useState(false);
  const [details, setDetails] = useState(false);
  const pending = m.sendStatus === "scheduled" || m.sendStatus === "sending";
  const files = m.attachments.filter((a) => !a.inline);
  const date = new Date(m.date);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return (
    <article className={cx("rounded-[20px] border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.03)]", m.sendStatus === "failed" ? "border-danger/40" : pending ? "border-sky-500/40" : "border-border")}>
      <header className="flex items-start gap-3 px-4 pt-4 @2xl/thread:px-5">
        <Avatar p={m.from} size={36} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onCollapse} disabled={!onCollapse}>
          <p className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14px] font-semibold">{personName(m.from)}</span>
            {m.auto && <span className="shrink-0 self-center rounded-full bg-surface-2 px-2 text-[11px] font-medium text-muted">Auto-reply</span>}
            <span className="hidden min-w-0 truncate text-[12.5px] text-muted @lg/thread:inline">{m.from.address}</span>
          </p>
          {m.groups.length > 0 ? (
            <p className="flex min-w-0 items-center gap-1 text-[12px] text-muted" title={[...m.to, ...m.cc].map((p) => p.address).join(", ")}>
              to {m.groups.map((g) => <span key={g.id} className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium text-white" style={{ background: g.color }}>{g.name}</span>)}
              <span className="truncate">· {m.to.length + m.cc.length} {m.to.length + m.cc.length === 1 ? "person" : "people"}</span>
            </p>
          ) : (
            <p className="truncate text-[12px] text-muted">to {[...m.to, ...m.cc].map((p) => personName(p)).join(", ") || "—"}</p>
          )}
        </button>
        <time dateTime={m.date} title={longTime(m.date)} className="shrink-0 pt-0.5 text-[12px] text-muted tabular-nums">
          {date.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })}, {date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
        </time>
        <Menu label="Message actions" trigger={(p) => <IconButton {...p} size="sm" label="Message actions" icon={<MoreHorizontal className="size-4" />} />} items={[{ label: "Reply", icon: <Reply />, onSelect: () => onReply("reply") }, { label: "Reply all", icon: <ReplyAll />, onSelect: () => onReply("replyAll") }, { label: "Forward", icon: <Forward />, onSelect: () => onReply("forward") }, ...(m.hasHtml ? [{ label: plain ? "Show formatted" : "Show plain text", icon: <FileText />, onSelect: () => setPlain(!plain) } as MenuItem] : []), "separator", { label: "Save this message to Notes…", icon: <NotebookPen />, onSelect: onNote }, { label: "Message details", icon: <Info />, onSelect: () => setDetails(true) }]} />
      </header>
      {pending && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-[12px] bg-sky-500/10 px-3 py-2 text-[12.5px] text-sky-800 @2xl/thread:mx-5 dark:text-sky-300">
          {m.sendStatus === "sending" ? <Loader2 className="size-3.5 animate-spin" /> : <AlarmClock className="size-3.5" />}
          {m.sendStatus === "scheduled" && m.sendAt ? `Scheduled for ${longTime(m.sendAt)}` : "Sending…"}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancel}>{m.sendStatus === "scheduled" ? "Cancel sending" : "Undo"}</Button>
        </div>
      )}
      {m.sendStatus === "failed" && <p className="mx-4 mt-3 rounded-[12px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger @2xl/thread:mx-5">Not sent: {m.sendError || "the mail server refused it"}</p>}
      {m.sendStatus === "cancelled" && <p className="mx-4 mt-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px] text-muted @2xl/thread:mx-5">Sending was cancelled.</p>}
      <div className="px-4 pt-3 pb-4 @2xl/thread:px-5 @2xl/thread:pb-5">
        {m.hasHtml && !plain ? (
          <>
            {!images && (
              <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] bg-surface-2 px-3 py-1.5 text-[12px] text-muted">
                <ImageIcon className="size-3.5 shrink-0" />
                <span className="flex-1">Pictures from the internet are hidden to protect your privacy.</span>
                <button type="button" onClick={onImages} className="font-semibold text-fg hover:underline">Show pictures</button>
              </div>
            )}
            <EmailFrame title={`Email from ${personName(m.from)}`} src={`${base}/messages/${m.id}/html${images ? "?images=1" : ""}`} />
          </>
        ) : (
          <div className="text-[14.5px] leading-[1.65] break-words whitespace-pre-wrap text-fg/90">{m.text || <span className="text-muted">(no text)</span>}</div>
        )}
        {files.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted"><Paperclip className="size-3.5" /> {files.length === 1 ? "1 attachment" : `${files.length} attachments`}</p>
            <div className="grid gap-2 @lg/thread:grid-cols-2 @3xl/thread:grid-cols-3">
              {files.map((a) =>
                a.stored ? (
                  <div key={a.id} className="flex min-w-0 items-center rounded-[12px] border border-border bg-[var(--surface-solid)] pr-1 transition-colors hover:bg-surface-2">
                  <a href={`${base}/attachments/${a.id}`} download={a.filename} className="group flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3">
                    {a.mime.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element -- an attachment from the mail API, not a static asset
                      <img src={`${base}/attachments/${a.id}`} alt="" className="size-9 rounded-[8px] object-cover" />
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-rose-500/10 text-[10px] font-bold text-rose-600 uppercase">{(a.filename.split(".").pop() ?? "file").slice(0, 4)}</span>
                    )}
                    <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium">{a.filename}</span><span className="text-[11.5px] text-muted">{fileSize(a.size)}</span></span>
                    <Download className="size-4 shrink-0 text-muted" />
                  </a>
                  <SaveToDocuments url={`${base}/attachments/${a.id}`} filename={a.filename} />
                  </div>
                ) : (
                  <span key={a.id} className="flex min-w-0 items-center gap-2 rounded-[12px] border border-dashed border-border px-3 py-2 text-[12px] text-muted" title="Too large to keep — open it in your mail provider"><Paperclip className="size-4 shrink-0" /><span className="truncate">{a.filename} · {fileSize(a.size)} · not stored</span></span>
                ),
              )}
            </div>
          </div>
        )}
      </div>
      {details && <DetailsDialog id={m.id} base={base} onClose={() => setDetails(false)} />}
    </article>
  );
}

/** IDs, size, folder, and what the sender checks (SPF, DKIM, DMARC) said. */
function DetailsDialog({ id, base, onClose }: { id: string; base: string; onClose: () => void }) {
  const { orgId, call } = useMailApi();
  const q = useQuery({ queryKey: mailKey(orgId, "details", id), queryFn: () => call<MessageDetails>(`messages/${id}/details`) });
  const d = q.data;
  const check = (label: string, v: string | null) => (
    <div className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-3 py-2">
      <span className="text-[12.5px] font-medium">{label}</span>
      {v ? <Badge tone={v === "pass" ? "success" : v === "none" || v === "neutral" ? undefined : "danger"}>{v === "pass" ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}{v}</Badge> : <span className="text-[12px] text-muted">Not reported</span>}
    </div>
  );
  const row = (k: string, v: React.ReactNode) => (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-t border-border py-2 text-[12.5px]">
      <span className="text-muted">{k}</span>
      <span className="min-w-0 font-mono text-[11.5px] break-all">{v || "—"}</span>
    </div>
  );
  return (
    <Dialog open onClose={onClose} size="lg" title="Message details" description="What the mail servers recorded about this email.">
      {!d ? (
        q.isError ? <Notice tone="danger" title="Couldn't load the details">{errorMessage(q.error)}</Notice> : <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4">
          <div>
            <p className="mb-2 text-[12px] font-semibold text-muted">Sender checks</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{check("SPF", d.auth.spf)}{check("DKIM", d.auth.dkim)}{check("DMARC", d.auth.dmarc)}</div>
            <p className="mt-2 text-[12px] text-muted">These say whether the sender&apos;s domain vouched for this email. A failure doesn&apos;t always mean fraud, but be careful with links and payments.</p>
          </div>
          <div>
            {row("Date", new Date(d.date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "long" }))}
            {row("Message-ID", d.messageId)}
            {row("In reply to", d.inReplyTo)}
            {row("References", d.references.length ? `${d.references.length} earlier messages` : "")}
            {row("Reply-To", d.replyTo)}
            {row("Folder", d.folder ?? "Not on the server yet")}
            {row("Size", fileSize(d.sizeBytes))}
            {row("Unsubscribe", d.listUnsubscribe)}
            {row("Automatic", d.auto ? "Yes — an auto-reply" : "No")}
            {d.auth.raw && row("Authentication", d.auth.raw)}
          </div>
          <a href={`${base}/messages/${id}/html`} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-sky-700 hover:underline dark:text-sky-400">Open the email on its own page →</a>
        </div>
      )}
    </Dialog>
  );
}

/** A clean, printable copy of a conversation (opened in its own tab). */
export function PrintThread({ id }: { id: string }) {
  const { orgId, call } = useMailApi();
  const q = useQuery({ queryKey: mailKey(orgId, "thread", id), queryFn: () => call<ThreadOut>(`threads/${id}`) });
  const done = useRef(false);
  useEffect(() => {
    if (q.data && !done.current) {
      done.current = true;
      setTimeout(() => window.print(), 400);
    }
  }, [q.data]);
  if (q.isError) return <div className="p-8"><Notice tone="danger" title="Couldn't open this conversation">{errorMessage(q.error)}</Notice></div>;
  if (!q.data) return <div className="mx-auto max-w-3xl p-8"><Skeleton className="h-60" /></div>;
  const d = q.data;
  return (
    <div className="mx-auto max-w-3xl bg-white px-6 py-8 text-[#1d1d1f] print:p-0">
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <button type="button" onClick={() => window.close()} className="text-[13px] text-muted hover:text-fg">Close</button>
        <Button size="sm" variant="primary" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Print</Button>
      </div>
      <h1 className="text-[22px] font-semibold">{d.thread.subject || "(no subject)"}</h1>
      <p className="mt-1 text-[12px] text-[#6e6e73]">{d.messages.length} {d.messages.length === 1 ? "message" : "messages"}</p>
      {d.messages.filter((m) => !m.sendStatus || m.sendStatus === "sent").map((m) => (
        <article key={m.id} className="mt-6 border-t border-[#d2d2d7] pt-4 break-inside-avoid">
          <p className="text-[14px] font-semibold">{personName(m.from)} <span className="font-normal text-[#6e6e73]">&lt;{m.from.address}&gt;</span>{m.auto && <span className="ml-2 text-[12px] font-normal text-[#6e6e73]">(auto-reply)</span>}</p>
          <p className="text-[12px] text-[#6e6e73]">To {[...m.to, ...m.cc].map((p) => (p.name ? `${p.name} <${p.address}>` : p.address)).join(", ")} · {new Date(m.date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
          <div className="mt-3 text-[13.5px] leading-relaxed whitespace-pre-wrap">{m.text || "(no text)"}</div>
          {m.attachments.filter((a) => !a.inline).length > 0 && <p className="mt-2 text-[12px] text-[#6e6e73]">Attachments: {m.attachments.filter((a) => !a.inline).map((a) => `${a.filename} (${fileSize(a.size)})`).join(", ")}</p>}
        </article>
      ))}
    </div>
  );
}

/** Small icon used in rows for "read" toggles. */
export const ReadIcon = ({ unread }: { unread: boolean }) => (unread ? <MailOpen className="size-4" /> : <Mail className="size-4" />);
