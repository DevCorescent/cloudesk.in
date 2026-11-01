"use client";

// One conversation: header, tabs (messages, pinned, files, decisions, polls,
// links), the live message list, the composer, and side panels for a thread
// and for AI (catch me up, ask the conversation).
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, AtSign, BarChart3, Bot, Check, ChevronDown, FileText, Gavel, Hash, Link2, Loader2, Lock, Maximize2, MessagesSquare, Minimize2, Phone, Pin, Search, Settings2, Sparkles, Star, UserPlus, Users, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useCompose } from "@/components/mail/compose-provider";
import { ConfirmDialog, Menu, useToast } from "@/components/ui/overlays";
import { Button, Input, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { copyText } from "@/lib/client/copy";
import { useShortcuts } from "@/components/ui/shortcut";
import type { CatchUpOut, ChannelOut, MessageOut, MetaOut, PageOut, PersonOut } from "@/lib/chat/api";
import { parseWhen, STATUSES, type PostIn, type Status } from "@/lib/chat/model";
import { plain, preview } from "@/lib/chat/text";
import { Composer, EmojiPicker, type ComposerHandle } from "./composer";
import { GuestsDialog } from "./guests";
import { ApprovalDialog, ChannelSettings, ChecklistDialog, DecisionDialog, ForwardDialog, MeetingDialog, PollDialog, RemindDialog, TaskDialog } from "./dialogs";
import { Message, RichText, type Ops } from "./message";
import { Avatar, channelTitle, chatKey, dayLabel, fileSize, presenceOf, shortWhen, useChatApi, useChatLive } from "./shared";

type Tab = "messages" | "pinned" | "files" | "decisions" | "polls" | "links";

// Full screen: the conversation takes the whole window (no app sidebar, top
// bar or chat list). The choice is remembered on this device; Esc leaves it.
const FULL_KEY = "cc-chat-full";
const fullSubs = new Set<() => void>();
const readFull = () => {
  try {
    return localStorage.getItem(FULL_KEY) === "1";
  } catch {
    return false;
  }
};
function setChatFull(on: boolean) {
  try {
    if (on) localStorage.setItem(FULL_KEY, "1");
    else localStorage.removeItem(FULL_KEY);
  } catch {
    /* storage blocked: still switch for this page view */
  }
  fullSubs.forEach((f) => f());
}
const useChatFull = () =>
  useSyncExternalStore(
    (cb) => {
      fullSubs.add(cb);
      return () => fullSubs.delete(cb);
    },
    readFull,
    () => false,
  );
type Side = { kind: "thread"; id: string } | { kind: "ai" } | null;
type Dlg = { kind: "poll" | "checklist" | "decision" | "approval" | "meeting"; init?: string } | { kind: "task"; m: MessageOut | null; init?: { title: string; owner?: string; due?: string }[] } | { kind: "forward" | "remind"; m: MessageOut } | { kind: "settings" } | { kind: "guests" } | { kind: "delete"; m: MessageOut } | { kind: "reject"; m: MessageOut } | null;

const GROUP_MS = 5 * 60_000;

/** Messages kept in order by seq, with updates merged in. */
function merge(list: MessageOut[], incoming: MessageOut[]) {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => (a.scheduledFor ? 1 : 0) - (b.scheduledFor ? 1 : 0) || a.seq - b.seq);
}

function useMessages(channelId: string, thread: string | null, around: string | null) {
  const { call } = useChatApi();
  const q = thread ? `thread=${thread}` : "";
  const reqKey = `${channelId}|${q}|${around ?? ""}`;
  // What's loaded, and for which request: a new request shows as loading until it answers.
  const [data, setData] = useState<{ key: string; list: MessageOut[]; hasMore: boolean; error: string | null; top: number }>({ key: "", list: [], hasMore: false, error: null, top: Number.MAX_SAFE_INTEGER });
  const [readSeqs, setReadSeqs] = useState<Record<string, number>>({});
  const loading = data.key !== reqKey;
  const list = useMemo(() => (loading ? [] : data.list), [loading, data.list]);
  const hasMore = !loading && data.hasMore;
  const error = loading ? null : data.error;
  const setList = useCallback((f: (l: MessageOut[]) => MessageOut[]) => setData((d) => ({ ...d, list: f(d.list) })), []);
  const setHasMore = useCallback((v: boolean) => setData((d) => ({ ...d, hasMore: v })), []);
  useEffect(() => {
    let live = true;
    call<PageOut>(`channels/${channelId}/messages?${q}${around && !thread ? `&around=${around}` : ""}`)
      .then((r) => {
        if (!live) return;
        setData({ key: reqKey, list: r.messages, hasMore: r.hasMore || !!(around && !thread), error: null, top: Math.max(0, ...r.messages.map((m) => m.seq)) });
        setReadSeqs(r.readSeqs);
      })
      .catch((e) => live && setData({ key: reqKey, list: [], hasMore: false, error: errorMessage(e), top: Number.MAX_SAFE_INTEGER }));
    return () => {
      live = false;
    };
  }, [call, channelId, q, around, thread, reqKey]);
  const older = useCallback(async () => {
    const first = list.find((m) => !m.scheduledFor);
    if (!first) return;
    const r = await call<PageOut>(`channels/${channelId}/messages?${q}&before=${first.seq}`);
    setList((l) => merge(l, r.messages));
    setHasMore(r.hasMore);
  }, [call, channelId, q, list, setList, setHasMore]);
  const newer = useCallback(async () => {
    const last = [...list].reverse().find((m) => !m.scheduledFor);
    const r = await call<PageOut>(`channels/${channelId}/messages?${q}${last ? `&after=${last.seq}` : ""}&limit=100`);
    setList((l) => merge(l, r.messages));
    setReadSeqs(r.readSeqs);
  }, [call, channelId, q, list, setList]);
  const refresh = useCallback(async (id: string) => {
    try {
      const r = await call<{ message: MessageOut }>(`messages/${id}`);
      setList((l) => (l.some((m) => m.id === id) || (thread ? r.message.parentId === thread || r.message.id === thread : !r.message.parentId) ? merge(l, [r.message]) : l));
    } catch {
      setList((l) => l.filter((m) => m.id !== id));
    }
  }, [call, thread, setList]);
  const upsert = useCallback((m: MessageOut) => setList((l) => merge(l, [m])), [setList]);
  const drop = useCallback((id: string) => setList((l) => l.filter((m) => m.id !== id)), [setList]);
  return { list, hasMore, loading, error, older, newer, refresh, upsert, drop, readSeqs, setReadSeqs, top: data.top };
}

/** The channel as messages see it: the same object until something they show changes (not unread counts or previews). */
function useSteadyChannel(c: ChannelOut) {
  const key = JSON.stringify({ ...c, unread: 0, mentions: 0, lastMessageAt: null, lastPreview: "", readSeq: 0, requests: 0 });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content on purpose
  return useMemo(() => c, [key]);
}

export function Conversation({ channel: liveChannel, meta, people, focus, onBack, onNavigate, refreshMeta, onTag }: { channel: ChannelOut; meta: MetaOut; people: Map<string, PersonOut>; focus: { m: string | null; t: string | null }; onBack: () => void; onNavigate: (path: string) => void; refreshMeta: () => void; onTag: (t: string) => void }) {
  const channel = useSteadyChannel(liveChannel);
  const { call, base, orgId } = useChatApi();
  const toast = useToast();
  const router = useRouter();
  const live = useChatLive();
  const mail = useCompose();
  const [tab, setTab] = useState<Tab>("messages");
  const full = useChatFull();
  // While a conversation is open, phones hide the app's top bar and tabs (see globals.css).
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-chat-open", "");
    return () => root.removeAttribute("data-chat-open");
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-chat-full", full);
    if (!full) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open], [role=menu]")) setChatFull(false);
    };
    // Capture phase: runs before an open menu or dialog handles (and closes on) the same key.
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("keydown", esc, true);
      root.removeAttribute("data-chat-full");
    };
  }, [full]);
  const [side, setSide] = useState<Side>(focus.t ? { kind: "thread", id: focus.t } : null);
  const search = useSearchParams();
  const [dlg, setDlg] = useState<Dlg>(() => (search?.get("guests") ? { kind: "guests" } : null));
  const [editing, setEditing] = useState<string | null>(null);
  const [emojiFor, setEmojiFor] = useState<{ m: MessageOut; r: DOMRect } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const msgs = useMessages(channel.id, null, focus.m && !focus.t ? focus.m : null);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [fresh, setFresh] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(focus.m);
  // Where "New messages" starts: what you'd read when you opened it.
  const [unreadFrom] = useState(liveChannel.readSeq);
  const title = channelTitle(channel, people);
  const dmPerson = channel.kind === "dm" ? people.get(channel.people[0] ?? "") : undefined;
  const admin = meta.me.admin || channel.role === "owner" || channel.role === "admin";
  const canInvite = channel.kind !== "dm" && (channel.role === "owner" || channel.role === "admin" || (meta.me.admin && (channel.member || (channel.kind === "channel" && channel.visibility === "public"))));

  // Live: new and changed messages in this conversation.
  const { refresh, newer, setReadSeqs } = msgs;
  useEffect(
    () =>
      live.on((e) => {
        if (e.ch !== channel.id) return;
        if (e.type === "r" && e.u && e.seq) setReadSeqs((r) => ({ ...r, [e.u!]: e.seq! }));
        if (e.type !== "m" || !e.id) return;
        if (e.thread) void refresh(e.thread);
        else {
          void refresh(e.id);
          if (!atBottom.current) setFresh((n) => n + 1);
        }
      }),
    [live, channel.id, refresh, setReadSeqs],
  );
  // Catch up after the connection was down.
  useEffect(() => {
    if (live.connected) void newer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.connected]);

  // Keep to the bottom when new messages come in (if you were there).
  const lastId = msgs.list.at(-1)?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || msgs.loading) return;
    if (highlight && document.getElementById(`m-${highlight}`)) {
      document.getElementById(`m-${highlight}`)!.scrollIntoView({ block: "center" });
      const t = setTimeout(() => setHighlight(null), 2500);
      return () => clearTimeout(t);
    }
    if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, msgs.loading, highlight]);

  // Read up to the newest message while you're at the bottom and looking.
  const lastSeq = useMemo(() => Math.max(0, ...msgs.list.filter((m) => !m.scheduledFor).map((m) => m.seq)), [msgs.list]);
  useEffect(() => {
    if (!channel.member || !lastSeq || !atBottom.current || document.visibilityState !== "visible") return;
    if (lastSeq <= liveChannel.readSeq) return;
    const t = setTimeout(() => void call(`channels/${channel.id}/read`, "POST", { seq: lastSeq }).then(refreshMeta).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [lastSeq, channel.id, channel.member, liveChannel.readSeq, call, refreshMeta]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && fresh) setFresh(0);
    if (el.scrollTop < 120 && msgs.hasMore && !msgs.loading) {
      const h = el.scrollHeight;
      void msgs.older().then(() => requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - h + el.scrollTop)));
    }
  };
  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setFresh(0);
  };

  const { upsert, refresh: refreshOne } = msgs;
  const post = useCallback(
    async (p: PostIn, thread: string | null = null) => {
      try {
        const r = await call<{ message: MessageOut; notInChannel: string[] }>(`channels/${channel.id}/messages`, "POST", { ...p, parentId: p.parentId ?? thread });
        if (!r.message.parentId || p.alsoToChannel) {
          upsert(r.message);
          atBottom.current = true;
        }
        if (r.message.scheduledFor) toast({ tone: "success", title: "Scheduled", description: `It posts ${new Date(r.message.scheduledFor).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })}.` });
        if (r.notInChannel.length) toast({ tone: "info", title: `${r.notInChannel.map((u) => people.get(u)?.name ?? "Someone").join(", ")} ${r.notInChannel.length === 1 ? "isn't" : "aren't"} in this conversation`, description: "They weren't notified. Add them from the channel's People." });
        try {
          localStorage.removeItem(`chat-draft:${channel.id}:${thread ?? ""}`);
        } catch {
          /* fine */
        }
        refreshMeta();
        return true;
      } catch (e) {
        toast({ tone: "error", title: "Couldn't send", description: errorMessage(e) });
        return false;
      }
    },
    [call, channel.id, upsert, toast, people, refreshMeta],
  );

  const act = useCallback(
    async (path: string, method: string, body?: unknown, done?: string) => {
      try {
        const r = await call<{ message?: MessageOut }>(path, method, body);
        // Thread replies live in the thread panel (it updates from the live event).
        if (r?.message && (!r.message.parentId || r.message.data.alsoToChannel)) upsert(r.message);
        if (done) toast({ tone: "success", title: done });
        return true;
      } catch (e) {
        toast({ tone: "error", title: errorMessage(e) });
        return false;
      }
    },
    [call, upsert, toast],
  );
  const reload = useCallback((m: MessageOut) => {
    void refreshOne(m.parentId ?? m.id).then(() => (m.parentId ? refreshOne(m.id) : undefined));
  }, [refreshOne]);

  const ops: Ops = useMemo(
    () => ({
      me: meta.me.id,
      people,
      channel,
      admin,
      react: (m, emoji, on) => void act(`messages/${m.id}/react`, "POST", { emoji, on }).then(() => reload(m)),
      reply: (m) => setSide({ kind: "thread", id: m.parentId ?? m.id }),
      edit: (m) => setEditing(m.id),
      remove: (m) => setDlg({ kind: "delete", m }),
      pin: (m, on) => void act(`messages/${m.id}/pin`, on ? "POST" : "DELETE", undefined, on ? "Pinned" : "Unpinned").then(() => reload(m)),
      save: (m, on) => void act(`messages/${m.id}/save`, "POST", { on }, on ? "Saved — find it under Saved" : "Removed from saved").then(() => reload(m)),
      remind: (m) => setDlg({ kind: "remind", m }),
      unread: (m) => void act(`channels/${channel.id}/read`, "POST", { unreadFrom: m.seq }, "Marked unread").then(refreshMeta),
      forward: (m) => setDlg({ kind: "forward", m }),
      task: (m) => setDlg({ kind: "task", m }),
      email: mail.available ? (m) => mail.compose({ subject: `${channel.kind === "channel" ? `#${channel.name}` : "Chat"}: ${preview(m.body, 60) || m.kind}`, body: `${plain(m.body)}\n\n— ${people.get(m.authorId ?? "")?.name ?? "Someone"}, in ${channel.kind === "channel" ? `#${channel.name}` : "a chat"} on Cloudesk`, title: "Email this message" }) : null,
      vote: (m, choice, on, note) => void act(`messages/${m.id}/vote`, "POST", { choice, on, note: note ?? "" }),
      settle: (m, state) => void act(`messages/${m.id}/settle`, "POST", { state }).then(() => reload(m)),
      approve: (m, choice) => (choice === "reject" ? setDlg({ kind: "reject", m }) : void act(`messages/${m.id}/vote`, "POST", { choice: "approve" }, "Approved")),
      calendar: (m) => void act(`messages/${m.id}/calendar`, "POST", {}, "Added to your calendar").then(() => reload(m)),
      emojiPicker: (m, el) => setEmojiFor({ m, r: el.getBoundingClientRect() }),
      tag: onTag,
      copyLink: (m) => void copyText(`${location.origin}/chat/${channel.id}?m=${m.id}${m.parentId ? `&t=${m.parentId}` : ""}`).then((ok) => toast(ok ? { tone: "success", title: "Link copied" } : { tone: "error", title: "Couldn't copy — your browser blocked it" })),
      copyText: (m) => void copyText(plain(m.body)).then((ok) => toast(ok ? { tone: "success", title: "Copied" } : { tone: "error", title: "Couldn't copy — your browser blocked it" })),
    }),
    [meta.me.id, people, channel, admin, act, reload, refreshMeta, mail, toast, onTag],
  );

  const onOpen = (what: string, init?: string) => {
    if (what === "summary") return setSide({ kind: "ai" });
    if (what === "task") return setDlg({ kind: "task", m: null, init: init ? [{ title: init }] : undefined });
    setDlg({ kind: what as "poll", init });
  };
  const onStatus = (st: string, note: string) => {
    const status = (STATUSES as readonly string[]).includes(st) ? (st as Status) : "available";
    void call("presence", "POST", { status, note: (STATUSES as readonly string[]).includes(st) ? note : `${st} ${note}`.trim() }).then(() => { toast({ tone: "success", title: "Status updated" }); refreshMeta(); });
  };
  const onRemind = (when: string) => {
    const d = parseWhen(when);
    const last = [...msgs.list].reverse().find((m) => !m.scheduledFor && !m.deleted);
    if (!d || !last) return toast({ tone: "error", title: "Try /remind in 2h, tomorrow 9am or friday" });
    void act(`messages/${last.id}/save`, "POST", { remindAt: d.toISOString() }, `I'll remind you ${d.toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })}`);
  };

  // Seen by (DMs and groups): under your last message, who's read it.
  const seenUnder = useMemo(() => {
    if (channel.kind === "channel") return null;
    const mine = [...msgs.list].reverse().find((m) => m.authorId === meta.me.id && !m.scheduledFor);
    if (!mine) return null;
    return { id: mine.id, by: Object.entries(msgs.readSeqs).filter(([u, s]) => u !== meta.me.id && s >= mine.seq).map(([u]) => u) };
  }, [channel.kind, msgs.list, msgs.readSeqs, meta.me.id]);

  const typing = (live.typing[channel.id] ?? []).filter((t) => !t.thread && t.u !== meta.me.id).map((t) => people.get(t.u)?.name.split(" ")[0] ?? "Someone");
  const pinnedCount = msgs.list.filter((m) => m.pinned).length;

  const me = meta.me.id;
  const editMeta = editing ? meta : null;
  const top = msgs.top;
  const rendered = useMemo(() => {
    const out: React.ReactNode[] = [];
    let prev: MessageOut | null = null;
    let newLine = false;
    for (const m of msgs.list) {
      if (!prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt)) {
        out.push(
          <div key={`d-${m.id}`} className="pointer-events-none sticky top-0 z-[5] flex justify-center bg-gradient-to-b from-bg via-bg/85 to-transparent pt-2 pb-3">
            <span className="chat-glass rounded-full border border-border px-3 py-0.5 text-[11.5px] font-semibold text-muted shadow-[0_2px_10px_-4px_rgba(0,0,0,0.18)]">{dayLabel(m.createdAt)}</span>
          </div>,
        );
        prev = null;
      }
      if (!newLine && channel.member && m.seq > unreadFrom && m.authorId !== me && !m.scheduledFor && m.kind !== "system") {
        newLine = true;
        out.push(<div key="new" className="chat-fade relative my-2 flex items-center gap-2 px-5"><span className="h-px flex-1 bg-gradient-to-r from-transparent via-red-500/50 to-red-500/70" /><span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-red-600 uppercase">New messages</span></div>);
        prev = null;
      }
      const compact = !!prev && prev.authorId === m.authorId && prev.kind !== "system" && m.kind !== "system" && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS && m.priority === "normal" && !m.forwardedFrom && !prev.replyCount;
      out.push(
        editing === m.id ? (
          <div key={m.id} className="px-4 py-2 @2xl/chat:px-5">
            <Composer
              channel={channel}
              meta={editMeta!}
              people={people}
              placeholder="Edit your message"
              draftKey={`chat-edit:${m.id}`}
              editing
              initial={toEditable(m, people)}
              onCancel={() => setEditing(null)}
              onOpen={() => {}}
              onStatus={() => {}}
              onRemind={() => {}}
              onSend={async (p) => {
                const ok = await act(`messages/${m.id}`, "PATCH", { body: p.body, records: p.records });
                if (ok) setEditing(null);
                return ok;
              }}
            />
          </div>
        ) : (
          <Message key={m.id} m={m} ops={ops} compact={compact} base={base} highlight={highlight === m.id} readBy={seenUnder?.id === m.id ? seenUnder.by : undefined} isNew={m.seq > top} />
        ),
      );
      prev = m;
    }
    return out;
  }, [msgs.list, channel, me, editMeta, people, ops, base, editing, highlight, unreadFrom, seenUnder, act, top]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "messages", label: "Messages", icon: <MessagesSquare /> },
    { id: "pinned", label: pinnedCount ? `Pinned · ${pinnedCount}` : "Pinned", icon: <Pin /> },
    { id: "files", label: "Files", icon: <FileText /> },
    { id: "decisions", label: "Decisions", icon: <Gavel /> },
    { id: "polls", label: "Polls & lists", icon: <BarChart3 /> },
    { id: "links", label: "Links & records", icon: <Link2 /> },
  ];
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;

  const header = (
    <header className="chat-conv-head chat-glass relative z-10 flex min-h-[64px] items-center gap-2 border-b border-border px-2.5 @2xl/chat:gap-2.5 @2xl/chat:px-4">
      <button type="button" aria-label="Back" onClick={onBack} className="chat-press grid size-9 place-items-center rounded-full hover:bg-surface-2 @4xl/chat:hidden"><ArrowLeft className="size-4" /></button>
      {channel.kind === "dm" ? (
        <Avatar id={channel.people[0] ?? ""} name={title} person={dmPerson} size={38} />
      ) : channel.kind === "group" ? (
        <span className="grid size-[38px] place-items-center rounded-[12px] bg-gradient-to-br from-violet-500 to-sky-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_12px_-6px_rgba(124,58,237,0.6)]"><Users className="size-4" /></span>
      ) : (
        <span className="grid size-[38px] place-items-center rounded-[12px] text-[17px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_12px_-6px_rgba(0,0,0,0.35)]" style={{ background: channel.color }}>{channel.emoji || (channel.visibility === "private" ? <Lock className="size-4" /> : <Hash className="size-4" />)}</span>
      )}
      <button type="button" onClick={() => setDlg({ kind: "settings" })} className="group/title min-w-0 flex-1 rounded-[10px] px-1 py-0.5 text-left">
        <p className="flex items-center gap-1.5 truncate text-[15.5px] font-semibold tracking-[-0.01em]">
          {channel.kind === "channel" && channel.visibility === "private" && <Lock className="size-3.5 shrink-0 text-muted" />}
          <span className="truncate">{title}</span>
          {channel.starred && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
          <ChevronDown className="size-3.5 shrink-0 text-subtle transition-transform group-hover/title:translate-y-px" />
        </p>
        <p className="truncate text-[12px] text-muted">
          {channel.kind === "dm" && dmPerson
            ? `${presenceOf(dmPerson).label}${dmPerson.note ? ` · ${dmPerson.emoji} ${dmPerson.note}` : ""}`
            : channel.topic || (channel.kind === "group" ? `${channel.memberCount} people` : `${channel.memberCount} members`)}
        </p>
      </button>
      <div className="flex items-center gap-0.5">
        {channel.kind !== "dm" && (
          <button type="button" onClick={() => setDlg({ kind: "settings" })} className="mr-1 hidden items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-0.5 text-[12px] font-medium hover:bg-surface-2 @3xl/chat:flex" title="People">
            <span className="flex -space-x-1.5">{channel.people.slice(0, 3).map((u) => <Avatar key={u} id={u} name={people.get(u)?.name ?? "?"} size={22} ring />)}</span>
            {channel.kind === "channel" && channel.people.length === 0 && <Users className="ml-1.5 size-3.5" />}
            {channel.memberCount}
          </button>
        )}
        {canInvite && (
          <button type="button" onClick={() => setDlg({ kind: "guests" })} title={liveChannel.requests ? `${liveChannel.requests} waiting to be let in` : "Invite people from outside the workspace"} className={cx("chat-press mr-1 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold", !liveChannel.requests && "@max-md/chat:hidden", liveChannel.requests ? "chat-pop bg-teal-600 text-white shadow-[0_4px_14px_-6px_rgba(13,148,136,0.8)] hover:bg-teal-700" : "border border-border bg-[var(--surface-solid)] hover:bg-surface-2")}>
            <UserPlus className="size-3.5" />
            <span className="hidden @2xl/chat:inline">{liveChannel.requests ? `${liveChannel.requests} waiting` : "Invite"}</span>
            {liveChannel.requests > 0 && <span className="@2xl/chat:hidden">{liveChannel.requests}</span>}
          </button>
        )}
        <Menu
          label="Views"
          trigger={(p) => (
            <button {...p} type="button" aria-label={`View: ${current.label}`} title="Messages, pinned, files and more" className="chat-press mx-0.5 inline-flex h-8 items-center gap-1 rounded-full border border-border bg-[var(--surface-solid)] pr-2 pl-3 text-[12.5px] font-medium hover:bg-surface-2">
              <span className="max-w-[6.5rem] truncate">{current.label}</span>
              <ChevronDown className="size-3.5 text-muted" />
            </button>
          )}
          items={tabs.map((t) => ({ label: t.label, icon: t.id === tab ? <Check /> : t.icon, onSelect: () => setTab(t.id) }))}
        />
        {channel.member && <span className="hidden @md/chat:contents"><HeaderBtn label="Start a video call" onClick={() => void post({ call: { title: "" } })}><Phone /></HeaderBtn></span>}
        <HeaderBtn label="Find in this conversation" onClick={() => setFindOpen((x) => !x)} active={findOpen}><Search /></HeaderBtn>
        {meta.ai && channel.ai && <HeaderBtn label="Catch me up (AI)" onClick={() => setSide(side?.kind === "ai" ? null : { kind: "ai" })} active={side?.kind === "ai"} tone="text-violet-600"><Sparkles /></HeaderBtn>}
        {channel.member && <span className="hidden @2xl/chat:contents"><HeaderBtn label={channel.starred ? "Unstar" : "Star"} onClick={() => void act(`channels/${channel.id}/prefs`, "PATCH", { starred: !channel.starred }).then(refreshMeta)}><Star className={cx(channel.starred && "fill-amber-400 text-amber-400")} /></HeaderBtn></span>}
        <span className="hidden lg:contents"><HeaderBtn label={full ? "Exit full screen (Esc)" : "Full screen"} onClick={() => setChatFull(!full)} active={full}>{full ? <Minimize2 /> : <Maximize2 />}</HeaderBtn></span>
        <HeaderBtn label="Settings and people" onClick={() => setDlg({ kind: "settings" })}><Settings2 /></HeaderBtn>
      </div>
    </header>
  );


  return (
    <div className="flex h-full min-w-0">
      <section className="flex min-w-0 flex-1 flex-col">
        {header}
        {channel.guests > 0 && (
          <button type="button" disabled={!canInvite} onClick={() => setDlg({ kind: "guests" })} className="flex items-center gap-2 border-b border-border bg-teal-500/[0.06] px-4 py-1.5 text-left text-[12px] text-teal-800 enabled:hover:bg-teal-500/10 dark:text-teal-200">
            <Users className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{channel.guests === 1 ? "1 guest" : `${channel.guests} guests`} from outside your workspace {channel.guests === 1 ? "is" : "are"} in this conversation and can read what&apos;s said here.</span>
            {canInvite && <span className="shrink-0 font-semibold">Manage</span>}
          </button>
        )}
        {findOpen && <FindBar channel={channel} ops={ops} base={base} onJump={(id) => { setTab("messages"); setHighlight(id); setFindOpen(false); onNavigate(`/chat/${channel.id}?m=${id}`); }} onClose={() => setFindOpen(false)} />}
        {tab === "messages" ? (
          <>
            {!channel.member && channel.kind === "channel" && (
              <div className="flex items-center justify-between gap-3 border-b border-border bg-sky-500/5 px-4 py-2.5 text-[13px]">
                <span>You&apos;re previewing <b className="font-semibold">#{channel.name}</b>.</span>
                <Button size="sm" variant="primary" onClick={() => void act(`channels/${channel.id}/join`, "POST").then(() => { refreshMeta(); void msgs.newer(); })}>Join channel</Button>
              </div>
            )}
            <div ref={scroller} onScroll={onScroll} className="chat-scroll relative min-h-0 flex-1 overflow-y-auto pb-3" role="log" aria-live="polite" aria-label={`Messages in ${title}`}>
              {msgs.loading ? (
                <div className="grid gap-4 p-5">{Array.from({ length: 6 }, (_, i) => <div key={i} className="flex gap-3"><Skeleton className="size-9 rounded-full" /><div className="grid flex-1 gap-1.5"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3.5 w-3/4" /></div></div>)}</div>
              ) : msgs.error ? (
                <p className="p-6 text-center text-[13px] text-muted">{msgs.error}</p>
              ) : (
                <>
                  {!msgs.hasMore && <Intro channel={channel} title={title} people={people} meta={meta} />}
                  {msgs.hasMore && <div className="flex justify-center py-3"><Loader2 className="size-4 animate-spin text-subtle" /></div>}
                  {rendered}
                </>
              )}
            </div>
            <div className="chat-foot relative">
              {fresh > 0 && (
                <button type="button" onClick={toBottom} className="chat-rise absolute -top-12 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-sky-600 px-4 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(2,132,199,0.7)] hover:bg-sky-700">
                  <ArrowDown className="size-3.5" />{fresh} new {fresh === 1 ? "message" : "messages"}
                </button>
              )}
              <p className={cx("flex h-6 items-center gap-1.5 px-5 text-[11.5px] text-muted transition-all duration-200", typing.length ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")} aria-live="polite">
                {typing.length ? <><TypingDots /><span><b className="font-semibold text-fg/80">{typing.length === 1 ? typing[0] : typing.length === 2 ? `${typing[0]} and ${typing[1]}` : "Several people"}</b> {typing.length === 1 ? "is" : "are"} typing…</span></> : " "}
              </p>
              <Composer
                ref={composer}
                channel={channel}
                meta={meta}
                people={people}
                placeholder={channel.kind === "channel" ? `Message #${channel.name}` : `Message ${title}`}
                draftKey={`chat-draft:${channel.id}:`}
                onSend={(p) => post(p)}
                onEditLast={() => {
                  const mine = [...msgs.list].reverse().find((m) => m.authorId === meta.me.id && m.kind === "text" && !m.deleted);
                  if (mine) setEditing(mine.id);
                }}
                onOpen={onOpen}
                onStatus={onStatus}
                onRemind={onRemind}
              />
            </div>
          </>
        ) : (
          <Collection channel={channel} what={tab} ops={ops} base={base} onJump={(id) => { setTab("messages"); setHighlight(id); onNavigate(`/chat/${channel.id}?m=${id}`); }} />
        )}
      </section>

      {side && (
        <aside className="chat-panel-in fixed inset-0 z-40 flex flex-col bg-[var(--surface-solid)] @5xl/chat:static @5xl/chat:z-auto @5xl/chat:w-[380px] @5xl/chat:shrink-0 @5xl/chat:border-l @5xl/chat:border-border">
          {side.kind === "thread" ? (
            <Thread key={side.id} channel={channel} meta={meta} people={people} rootId={side.id} ops={ops} base={base} post={post} onClose={() => setSide(null)} onOpen={onOpen} onStatus={onStatus} onRemind={onRemind} />
          ) : (
            <AiPanel channel={channel} people={people} ops={ops} onClose={() => setSide(null)} onJump={(id) => { setHighlight(id); setTab("messages"); }} onTasks={(items) => setDlg({ kind: "task", m: null, init: items })} post={post} />
          )}
        </aside>
      )}

      {emojiFor && <EmojiPicker anchor={emojiFor.r} onClose={() => setEmojiFor(null)} onPick={(e) => { ops.react(emojiFor.m, e, true); setEmojiFor(null); }} />}
      {dlg?.kind === "poll" && <PollDialog init={dlg.init ? { question: dlg.init } : undefined} onClose={() => setDlg(null)} send={(p) => post(p)} />}
      {dlg?.kind === "checklist" && <ChecklistDialog init={dlg.init ? { title: dlg.init } : undefined} onClose={() => setDlg(null)} send={(p) => post(p)} />}
      {dlg?.kind === "decision" && <DecisionDialog init={dlg.init} onClose={() => setDlg(null)} send={(p) => post(p)} />}
      {dlg?.kind === "approval" && <ApprovalDialog init={dlg.init} channelPeople={[...channel.people, meta.me.id]} people={channel.kind === "channel" ? meta.people : meta.people.filter((p) => channel.people.includes(p.id) || p.id === meta.me.id)} onClose={() => setDlg(null)} send={(p) => post(p)} />}
      {dlg?.kind === "meeting" && <MeetingDialog init={dlg.init} onClose={() => setDlg(null)} send={(p) => post(p)} />}
      {dlg?.kind === "task" && <TaskDialog m={dlg.m} init={dlg.init} people={meta.people} onClose={() => { setDlg(null); if (dlg.m) reload(dlg.m); }} />}
      {dlg?.kind === "forward" && <ForwardDialog m={dlg.m} meta={meta} onClose={() => setDlg(null)} onDone={(id) => { setDlg(null); router.push(`/chat/${id}`); }} />}
      {dlg?.kind === "remind" && <RemindDialog m={dlg.m} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(dlg.m); }} />}
      {dlg?.kind === "guests" && <GuestsDialog channel={channel} meta={meta} people={people} onClose={() => { setDlg(null); if (search?.get("guests")) onNavigate(`/chat/${channel.id}`); }} onChanged={refreshMeta} />}
      {dlg?.kind === "settings" && <ChannelSettings c={channel} meta={meta} onClose={() => setDlg(null)} onChanged={refreshMeta} onLeft={() => { setDlg(null); refreshMeta(); onNavigate("/chat"); }} />}
      {dlg?.kind === "delete" && (
        <ConfirmDialog open title="Delete this message?" description="It's removed for everyone. Its files go too. This can't be undone." confirmLabel="Delete" destructive onClose={() => setDlg(null)} onConfirm={async () => { const m = dlg.m; setDlg(null); if (await act(`messages/${m.id}`, "DELETE")) reload(m); }} />
      )}
      {dlg?.kind === "reject" && <RejectDialog onClose={() => setDlg(null)} onReject={async (note) => { const ok = await act(`messages/${dlg.m.id}/vote`, "POST", { choice: "reject", note }, "Rejected"); if (ok) setDlg(null); }} />}
      <span hidden>{orgId}</span>
    </div>
  );
}

/** A message back into the composer: tokens shown as @Name / #Label again. */
function toEditable(m: MessageOut, people: Map<string, PersonOut>) {
  const refs: Record<string, string> = {};
  const links: Record<string, string> = {};
  let text = m.body.replace(/@\[([^\]\n]{1,80})\]\(u:([0-9a-f-]{36})\)/g, (tok, name: string, id: string) => {
    const display = `@${people.get(id)?.name ?? name}`;
    refs[display] = tok;
    return display;
  });
  text = text.replace(/#\[([^\]\n]{1,120})\]\(r:([a-z0-9_-]{1,40})\/([\w-]{1,80})\)/g, (tok, label: string, kind: string, id: string) => {
    refs[`#${label}`] = tok;
    const r = m.mentions.records.find((x) => x.kind === kind && x.id === id);
    if (r?.link) links[`${kind}/${id}`] = r.link;
    return `#${label}`;
  });
  return { text, refs, links };
}

function HeaderBtn({ label, onClick, children, active, tone }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; tone?: string }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={cx("chat-press grid size-9 place-items-center rounded-[11px] hover:bg-surface-2 [&>svg]:size-[17px]", active ? "bg-surface-2 text-fg" : (tone ?? "text-muted hover:text-fg"))}>{children}</button>;
}

function TypingDots() {
  return (
    <span className="inline-flex h-4 items-center gap-[3px] rounded-full bg-surface-2 px-1.5">
      {[0, 1, 2].map((i) => <span key={i} className="chat-typing-dot size-[5px] rounded-full bg-muted" style={{ animationDelay: `${i * 0.16}s` }} />)}
    </span>
  );
}

function Intro({ channel, title, people, meta }: { channel: ChannelOut; title: string; people: Map<string, PersonOut>; meta: MetaOut }) {
  const p = channel.kind === "dm" ? people.get(channel.people[0] ?? "") : undefined;
  const search = useShortcuts().keys("mod+k");
  return (
    <div className="px-5 pt-10 pb-4">
      {channel.kind === "dm" && p ? <Avatar id={p.id} name={p.name} person={p} size={64} /> : <span className="grid size-16 place-items-center rounded-[20px] text-[28px] text-white" style={{ background: channel.kind === "group" ? "linear-gradient(135deg,#7c3aed,#0ea5e9)" : channel.color }}>{channel.emoji || (channel.kind === "group" ? <Users className="size-7" /> : <Hash className="size-7" />)}</span>}
      <h2 className="mt-3 text-[22px] font-semibold tracking-tight">{channel.kind === "channel" ? `Welcome to #${channel.name}` : title}</h2>
      <p className="mt-1 max-w-xl text-[13.5px] text-muted">
        {channel.kind === "dm" ? `This is the start of your conversation with ${p?.name ?? "them"}. ${p?.email ?? ""}` : channel.description || channel.topic || (channel.kind === "group" ? `The start of your group chat with ${channel.people.map((u) => people.get(u)?.name.split(" ")[0]).filter(Boolean).join(", ")}.` : "The start of this channel.")}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-[12px] text-muted">
        {["@ to mention someone", "# to link an invoice, deal or any record", "/poll, /decide, /approve, /call", ...(search ? [`${search} to search everything`] : [])].map((t) => <span key={t} className="rounded-full border border-border px-2.5 py-1">{t}</span>)}
      </div>
      <span hidden>{meta.me.id}</span>
    </div>
  );
}

function FindBar({ channel, ops, base, onJump, onClose }: { channel: ChannelOut; ops: Ops; base: string; onJump: (id: string) => void; onClose: () => void }) {
  const { call, orgId } = useChatApi();
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDeb(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const name = channel.kind === "channel" ? channel.name : null;
  const r = useQuery({ queryKey: chatKey(orgId, "find", channel.id, deb), queryFn: () => call<{ messages: MessageOut[] }>(`search?q=${encodeURIComponent(`${deb}${name ? ` in:${name}` : ""}`)}`), enabled: deb.length > 1 });
  const hits = (r.data?.messages ?? []).filter((m) => m.channelId === channel.id);
  return (
    <div className="border-b border-border bg-surface-2/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <Search className="size-4 text-muted" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in this conversation — try from:ravi or has:file" aria-label="Find" className="h-8 flex-1" />
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-full hover:bg-surface-2"><X className="size-4" /></button>
      </div>
      {deb.length > 1 && (
        <ul className="mt-2 max-h-64 overflow-y-auto rounded-[12px] border border-border bg-[var(--surface-solid)]">
          {r.isFetching && <li className="p-3 text-[12.5px] text-muted">Searching…</li>}
          {!r.isFetching && !hits.length && <li className="p-3 text-[12.5px] text-muted">Nothing found</li>}
          {hits.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onJump(m.id)} className="flex w-full gap-2.5 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface-2">
                <Avatar id={m.authorId ?? ""} name={ops.people.get(m.authorId ?? "")?.name ?? "?"} size={24} />
                <span className="min-w-0 flex-1"><span className="flex justify-between text-[12px]"><b className="font-semibold">{ops.people.get(m.authorId ?? "")?.name}</b><span className="text-subtle">{shortWhen(m.createdAt)}</span></span><span className="line-clamp-2 text-[13px] text-fg/85">{preview(m.body, 200) || `[${m.kind}]`}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span hidden>{base}</span>
    </div>
  );
}

function Collection({ channel, what, ops, base, onJump }: { channel: ChannelOut; what: Exclude<Tab, "messages">; ops: Ops; base: string; onJump: (id: string) => void }) {
  const { call, orgId } = useChatApi();
  const live = useChatLive();
  const r = useQuery({ queryKey: chatKey(orgId, "collection", channel.id, what), queryFn: () => call<{ messages?: MessageOut[]; files?: { id: string; filename: string; mime: string; size: number; uploadedBy: string; createdAt: string; messageId: string }[] }>(`channels/${channel.id}/${what}`) });
  const { refetch } = r;
  useEffect(() => live.on((e) => e.ch === channel.id && e.type === "m" && void refetch()), [live, channel.id, refetch]);
  const empty: Record<string, [string, string]> = {
    pinned: ["Nothing pinned yet", "Pin important messages from their ⋯ menu — they collect here for everyone."],
    files: ["No files yet", "Files shared here (drop, paste or attach them in the composer) collect here."],
    decisions: ["No decisions yet", "Use /decide or + → Propose a decision. Approvals show here too — a running record of what was agreed."],
    polls: ["No polls or checklists yet", "Use /poll Question | choice | choice, or + → Poll."],
    links: ["No links or records yet", "Type # in a message to link an invoice, deal, contact or any record."],
  };
  if (r.isLoading) return <div className="grid gap-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (what === "files") {
    const files = r.data?.files ?? [];
    if (!files.length) return <Empty t={empty.files!} />;
    return (
      <ul className="min-h-0 flex-1 overflow-y-auto p-3">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-3 rounded-[12px] px-3 py-2 hover:bg-surface-2">
            <span className="grid size-10 place-items-center rounded-[10px] bg-sky-500/10 text-sky-600"><FileText className="size-5" /></span>
            <a href={`${base}/files/${f.id}?download=1`} className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{f.filename}</span><span className="text-[12px] text-muted">{fileSize(f.size)} · {ops.people.get(f.uploadedBy)?.name ?? "Someone"} · {shortWhen(f.createdAt)}</span></a>
            <Button size="sm" variant="ghost" onClick={() => onJump(f.messageId)}>Show</Button>
          </li>
        ))}
      </ul>
    );
  }
  const list = r.data?.messages ?? [];
  if (!list.length) return <Empty t={empty[what]!} />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2">
      {list.map((m) => (
        <div key={m.id} className="border-b border-border pb-2 last:border-0">
          <Message m={m} ops={ops} compact={false} base={base} inThread />
          <button type="button" onClick={() => onJump(m.parentId ?? m.id)} className="ml-16 text-[12px] font-medium text-sky-700 hover:underline dark:text-sky-400">Show in conversation</button>
        </div>
      ))}
    </div>
  );
}

function Empty({ t }: { t: [string, string] }) {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      <div className="max-w-sm"><p className="text-[15px] font-semibold">{t[0]}</p><p className="mt-1 text-[13px] text-muted">{t[1]}</p></div>
    </div>
  );
}

function Thread({ channel, meta, people, rootId, ops, base, post, onClose, onOpen, onStatus, onRemind }: { channel: ChannelOut; meta: MetaOut; people: Map<string, PersonOut>; rootId: string; ops: Ops; base: string; post: (p: PostIn, thread: string | null) => Promise<boolean>; onClose: () => void; onOpen: (w: string, init?: string) => void; onStatus: (s: string, n: string) => void; onRemind: (w: string) => void }) {
  const live = useChatLive();
  const t = useMessages(channel.id, rootId, null);
  const [also, setAlso] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const { refresh } = t;
  useEffect(() => live.on((e) => { if (e.ch === channel.id && e.type === "m" && e.id && (e.thread === rootId || e.id === rootId)) void refresh(e.id); }), [live, channel.id, rootId, refresh]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [t.list.length]);
  const root = t.list.find((m) => m.id === rootId);
  const replies = t.list.filter((m) => m.id !== rootId);
  const typing = (live.typing[channel.id] ?? []).filter((x) => x.thread === rootId && x.u !== meta.me.id).map((x) => people.get(x.u)?.name.split(" ")[0] ?? "Someone");
  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border px-4">
        <MessagesSquare className="size-4 text-muted" />
        <div className="min-w-0 flex-1"><p className="text-[14.5px] font-semibold">Thread</p><p className="truncate text-[12px] text-muted">{channel.kind === "channel" ? `#${channel.name}` : channelTitle(channel, people)}</p></div>
        <button type="button" aria-label="Close thread" onClick={onClose} className="grid size-8 place-items-center rounded-full hover:bg-surface-2"><X className="size-4" /></button>
      </header>
      <div ref={scroller} className="@container/chat min-h-0 flex-1 overflow-y-auto py-2">
        {t.loading ? <div className="p-4"><Skeleton className="h-20" /></div> : !root ? <p className="p-6 text-center text-[13px] text-muted">This message isn&apos;t here any more.</p> : (
          <>
            <Message m={root} ops={ops} compact={false} base={base} inThread />
            <div className="my-2 flex items-center gap-2 px-4 text-[11.5px] font-semibold text-muted"><span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span><span className="h-px flex-1 bg-border" /></div>
            {replies.map((m, i) => <Message key={m.id} m={m} ops={ops} compact={!!replies[i - 1] && replies[i - 1]!.authorId === m.authorId && new Date(m.createdAt).getTime() - new Date(replies[i - 1]!.createdAt).getTime() < GROUP_MS && m.kind !== "system"} base={base} inThread isNew={m.seq > t.top} />)}
          </>
        )}
      </div>
      <p className={cx("h-5 px-4 text-[11.5px] text-muted", !typing.length && "opacity-0")}>{typing.length ? `${typing.join(", ")} ${typing.length === 1 ? "is" : "are"} typing…` : " "}</p>
      <div className="@container/chat">
        {root && (
          <Composer
            channel={channel}
            meta={meta}
            people={people}
            thread={rootId}
            placeholder="Reply in thread"
            draftKey={`chat-draft:${channel.id}:${rootId}`}
            onSend={async (p) => {
              const ok = await post({ ...p, parentId: rootId, alsoToChannel: also }, rootId);
              if (ok) void t.newer();
              return ok;
            }}
            onOpen={onOpen}
            onStatus={onStatus}
            onRemind={onRemind}
            extra={channel.member ? <label className="ml-1 hidden items-center gap-1.5 text-[11.5px] text-muted @sm/chat:flex"><input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} className="size-3.5 rounded" />Also send to {channel.kind === "channel" ? `#${channel.name}` : "the chat"}</label> : undefined}
          />
        )}
      </div>
    </>
  );
}

function AiPanel({ channel, people, ops, onClose, onJump, onTasks, post }: { channel: ChannelOut; people: Map<string, PersonOut>; ops: Ops; onClose: () => void; onJump: (id: string) => void; onTasks: (items: { title: string; owner?: string; due?: string }[]) => void; post: (p: PostIn) => Promise<boolean> }) {
  const { call } = useChatApi();
  const toast = useToast();
  const [scope, setScope] = useState<"unread" | "day" | "week" | "all">(channel.unread > 0 ? "unread" : "day");
  const [out, setOut] = useState<CatchUpOut | null>(null);
  const [busy, setBusy] = useState(true);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; found: boolean; sources: { id: string; n: number }[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const run = useCallback(async (sc: typeof scope) => {
    setBusy(true);
    try {
      setOut(await call<CatchUpOut>(`channels/${channel.id}/ai/catch-up`, "POST", { scope: sc }));
    } catch (e) {
      toast({ tone: "error", title: "AI couldn't answer", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [call, channel.id, toast]);
  // The first catch-up, as the panel opens.
  useEffect(() => {
    let live = true;
    call<CatchUpOut>(`channels/${channel.id}/ai/catch-up`, "POST", { scope: channel.unread > 0 ? "unread" : "day" })
      .then((r) => live && setOut(r))
      .catch((e) => live && toast({ tone: "error", title: "AI couldn't answer", description: errorMessage(e) }))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [call, channel.id, channel.unread, toast]);
  const ask = async () => {
    if (question.trim().length < 3) return;
    setAsking(true);
    try {
      setAnswer(await call(`channels/${channel.id}/ai/ask`, "POST", { question }));
    } catch (e) {
      toast({ tone: "error", title: "AI couldn't answer", description: errorMessage(e) });
    } finally {
      setAsking(false);
    }
  };
  const share = () => {
    if (!out) return;
    const body = [`**Catch-up** (${scope === "unread" ? "unread" : scope === "day" ? "last 24 hours" : scope === "week" ? "last 7 days" : "everything"}) — by AI, check before acting`, out.summary, out.decisions.length ? `**Decisions**\n${out.decisions.map((d) => `- ${d}`).join("\n")}` : "", out.actions.length ? `**Action items**\n${out.actions.map((a) => `- ${a.text}${a.owner ? ` — ${a.owner}` : ""}${a.due ? ` (by ${a.due})` : ""}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
    void post({ body }).then((ok) => ok && toast({ tone: "success", title: "Shared in the conversation" }));
  };
  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"><Sparkles className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-[14.5px] font-semibold">AI catch-up</p><p className="truncate text-[12px] text-muted">{channel.kind === "channel" ? `#${channel.name}` : channelTitle(channel, people)}</p></div>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-full hover:bg-surface-2"><X className="size-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap gap-1">
          {(["unread", "day", "week", "all"] as const).map((s) => (
            <button key={s} type="button" onClick={() => { setScope(s); void run(s); }} className={cx("h-7 rounded-full px-2.5 text-[12px]", scope === s ? "bg-fg font-medium text-bg" : "border border-border hover:bg-surface-2")}>{s === "unread" ? `Unread${channel.unread ? ` (${channel.unread})` : ""}` : s === "day" ? "Last 24 h" : s === "week" ? "Last 7 days" : "Everything"}</button>
          ))}
        </div>
        {busy ? (
          <div className="grid gap-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /><p className="mt-2 flex items-center gap-2 text-[12px] text-muted"><Loader2 className="size-3.5 animate-spin" />Reading {scope === "all" ? "the conversation" : "what you missed"}…</p></div>
        ) : out ? (
          <div className="grid gap-4 text-[13.5px]">
            <div>
              <p className="leading-relaxed">{out.summary}</p>
              {out.mood && <p className="mt-1.5 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-300">Tone: {out.mood}</p>}
              {out.count > 0 && <p className="mt-1 text-[11.5px] text-subtle">From {out.count} {out.count === 1 ? "message" : "messages"} · AI can be wrong — check before acting</p>}
            </div>
            {out.questions.length > 0 && <Section icon={<AtSign />} title="Waiting on you">{out.questions.map((q, i) => <li key={i}>{q}</li>)}</Section>}
            {out.decisions.length > 0 && <Section icon={<Gavel />} title="Decided">{out.decisions.map((d, i) => <li key={i}>{d}</li>)}</Section>}
            {out.actions.length > 0 && (
              <Section icon={<FileText />} title="Action items">
                {out.actions.map((a, i) => <li key={i}>{a.text}{a.owner && <span className="text-muted"> — {a.owner}</span>}{a.due && <span className="text-muted"> · by {a.due}</span>}</li>)}
                <li className="list-none pt-1.5"><Button size="sm" onClick={() => onTasks(out.actions.map((a) => ({ title: a.text, owner: a.owner, due: a.due })))}>Make these tasks</Button></li>
              </Section>
            )}
            {out.count > 0 && channel.member && <div><Button size="sm" variant="ghost" icon={<MessagesSquare className="size-3.5" />} onClick={share}>Share this summary in the conversation</Button></div>}
          </div>
        ) : null}
        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><Bot className="size-4 text-violet-600" />Ask this conversation</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What did we agree on pricing?" aria-label="Question" />
            <Button type="submit" variant="primary" loading={asking} disabled={question.trim().length < 3}>Ask</Button>
          </form>
          {answer && (
            <div className="mt-3 rounded-[14px] border border-border bg-surface-2/40 p-3 text-[13.5px]">
              <RichText body={answer.answer} ops={ops} />
              {answer.sources.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{answer.sources.map((s) => <button key={s.id} type="button" onClick={() => onJump(s.id)} className="rounded-full border border-border bg-[var(--surface-solid)] px-2 py-0.5 text-[11.5px] font-medium hover:bg-surface-2">Message {s.n} →</button>)}</div>}
              {!answer.found && <p className="mt-1.5 text-[11.5px] text-muted">Not found in this conversation.</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase [&>svg]:size-3.5">{icon}{title}</p>
      <ul className="ml-4 list-disc space-y-1">{children}</ul>
    </div>
  );
}

function RejectDialog({ onClose, onReject }: { onClose: () => void; onReject: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog open title="Reject this request?" description={<div className="grid gap-2"><span>Say why — they&apos;ll see it with your answer.</span><Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" aria-label="Reason" /></div>} confirmLabel="Reject" destructive onClose={onClose} onConfirm={() => void (note.trim() && onReject(note.trim()))} />
  );
}

