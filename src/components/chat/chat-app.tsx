"use client";

// Chat: the list of conversations on the left (starred, channels, direct
// messages — unread first in bold, with presence), and on the right a
// conversation, or Home (what needs you), Activity, Saved, Search or Browse.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, BellOff, Bookmark, BookmarkCheck, CheckCheck, ChevronDown, CircleCheck, Clock3, Compass, Hash, Home, Inbox, Lock, MessageSquarePlus, MoreHorizontal, Plus, Search, Sparkles, Star, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImportButton } from "@/components/import/buttons";
import type { ImportResult } from "@/components/import/smart-import";
import { Dialog, Menu, useToast } from "@/components/ui/overlays";
import { KeyboardOnly, Keys } from "@/components/ui/shortcut";
import { Button, EmptyState, ErrorState, Input, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { ActivityItem, ChannelOut, MessageOut, MetaOut, PersonOut } from "@/lib/chat/api";
import { STATUS_LABEL } from "@/lib/chat/model";
import { copyText } from "@/lib/client/copy";
import { target } from "@/lib/import/targets";
import "./chat.css";
import { Conversation } from "./conversation";
import { NewChannelDialog, NewChatDialog, StatusDialog } from "./dialogs";
import { Message, type Ops } from "./message";
import { Avatar, channelTitle, chatKey, presenceOf, shortWhen, useChatApi, useChatLive, useChatMeta, usePeopleMap } from "./shared";

export function ChatApp() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId, call } = useChatApi();
  const meta = useChatMeta();
  const toast = useToast();
  const path = pathname.replace(/^\/chat\/?/, "").split("/").filter(Boolean);
  const view = path[0] ?? "home";
  const channelId = /^[0-9a-f-]{36}$/i.test(view) ? view : null;
  const [dlg, setDlg] = useState<"channel" | "chat" | "status" | "switch" | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const refreshMeta = useCallback(() => void qc.invalidateQueries({ queryKey: chatKey(orgId, "meta") }), [qc, orgId]);
  // Guests are in the map too, so their names show; pickers use meta.people (members only).
  const people = usePeopleMap(meta.data);
  const go = useCallback((p: string) => router.push(p), [router]);
  // Stable callbacks, so an open conversation doesn't redraw every message when the sidebar refreshes.
  const back = useCallback(() => go("/chat"), [go]);
  const onTag = useCallback((t: string) => go(`/chat/search?q=${encodeURIComponent(`tag:${t}`)}`), [go]);

  // Mod+J (⌘J / Ctrl+J): jump to a conversation. Alt+↑/↓: previous / next conversation.
  const list = useMemo(() => (meta.data?.channels ?? []).filter((c) => c.member), [meta.data?.channels]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setDlg("switch");
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && channelId) {
        e.preventDefault();
        const i = list.findIndex((c) => c.id === channelId);
        const next = list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length];
        if (next) go(`/chat/${next.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [channelId, list, go]);

  if (meta.isError) return <div className="p-6"><ErrorState message={errorMessage(meta.error)} onRetry={() => void meta.refetch()} /></div>;
  if (!meta.data) return <div className="grid h-[var(--app-h)] grid-cols-[300px_1fr] gap-0"><div className="grid content-start gap-2 border-r border-border p-4">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div><Skeleton className="m-6" /></div>;
  const m = meta.data;
  const channel = channelId ? m.channels.find((c) => c.id === channelId) : null;

  const rail = (
    <Rail
      meta={m}
      people={people}
      active={channelId ?? view}
      onlyUnread={onlyUnread}
      setOnlyUnread={setOnlyUnread}
      onNew={(k) => setDlg(k)}
      onStatus={() => setDlg("status")}
      onSearch={(q) => go(`/chat/search?q=${encodeURIComponent(q)}`)}
      onPrefs={(c, body, done) => void call(`channels/${c.id}/prefs`, "PATCH", body).then(() => { refreshMeta(); if (done) toast({ tone: "success", title: done }); }).catch((e) => toast({ tone: "error", title: errorMessage(e) }))}
      onRead={(c) => void call(`channels/${c.id}/read`, "POST", {}).then(refreshMeta)}
      onReadAll={() => void call("read-all", "POST").then(() => { refreshMeta(); toast({ tone: "success", title: "All caught up" }); })}
      refreshMeta={refreshMeta}
    />
  );
  const showRail = !channelId && view === "home";

  return (
    <div className="@container/chat relative h-[var(--app-h)] min-h-[480px] overflow-hidden">
      <div className="grid h-full grid-cols-1 @4xl/chat:grid-cols-[288px_minmax(0,1fr)]">
        <aside className={cx("min-h-0 border-r border-border bg-gradient-to-b from-surface/70 to-surface/30", showRail ? "block" : "hidden @4xl/chat:block")}>{rail}</aside>
        <main className={cx("min-h-0 min-w-0", showRail && "hidden @4xl/chat:block")}>
          {channelId ? (
            channel ? (
              <Conversation key={channel.id} channel={channel} meta={m} people={people} focus={{ m: params.get("m"), t: params.get("t") }} onBack={back} onNavigate={go} refreshMeta={refreshMeta} onTag={onTag} />
            ) : (
              <div className="grid h-full place-items-center p-8"><EmptyState title="This conversation isn't available" description="It may be private, or it was removed." action={<Button onClick={() => go("/chat")}>Back to Chat</Button>} /></div>
            )
          ) : view === "activity" ? (
            <ActivityView meta={m} people={people} onBack={() => go("/chat")} />
          ) : view === "saved" ? (
            <SavedView meta={m} people={people} onBack={() => go("/chat")} />
          ) : view === "search" ? (
            <SearchView key={params.get("q") ?? ""} meta={m} people={people} q={params.get("q") ?? ""} onBack={() => go("/chat")} />
          ) : view === "browse" ? (
            <BrowseView meta={m} onBack={() => go("/chat")} onOpen={(id) => go(`/chat/${id}`)} refreshMeta={refreshMeta} />
          ) : (
            <HomeView meta={m} people={people} onOpen={(id) => go(`/chat/${id}`)} onNew={(k) => setDlg(k)} />
          )}
        </main>
      </div>
      {dlg === "channel" && <NewChannelDialog meta={m} onClose={() => setDlg(null)} onDone={(id) => { setDlg(null); refreshMeta(); go(`/chat/${id}`); }} />}
      {dlg === "chat" && <NewChatDialog meta={m} onClose={() => setDlg(null)} onDone={(id) => { setDlg(null); refreshMeta(); go(`/chat/${id}`); }} />}
      {dlg === "status" && <StatusDialog meta={m} onClose={() => setDlg(null)} onDone={() => { setDlg(null); refreshMeta(); }} />}
      {dlg === "switch" && <Switcher meta={m} people={people} onClose={() => setDlg(null)} onPick={(id) => { setDlg(null); go(id.startsWith("/") ? id : `/chat/${id}`); }} />}
    </div>
  );
}

// ── The rail ────────────────────────────────────────────────────────────────

function ConvIcon({ c, people, size = 22 }: { c: ChannelOut; people: Map<string, PersonOut>; size?: number }) {
  if (c.kind === "dm") return <Avatar id={c.people[0] ?? c.id} name={channelTitle(c, people)} person={people.get(c.people[0] ?? "")} size={size} />;
  if (c.kind === "group") return <span className="grid shrink-0 place-items-center rounded-[7px] bg-gradient-to-br from-violet-500 to-sky-500 text-white" style={{ width: size, height: size }}><Users className="size-3" /></span>;
  return <span className="grid shrink-0 place-items-center rounded-[7px] text-[12px] text-white" style={{ width: size, height: size, background: c.color }}>{c.emoji || (c.visibility === "private" ? <Lock className="size-3" /> : <Hash className="size-3" />)}</span>;
}

function Rail({ meta, people, active, onlyUnread, setOnlyUnread, onNew, onStatus, onSearch, onPrefs, onRead, onReadAll, refreshMeta }: { meta: MetaOut; people: Map<string, PersonOut>; active: string; onlyUnread: boolean; setOnlyUnread: (v: boolean) => void; onNew: (k: "channel" | "chat") => void; onStatus: () => void; onSearch: (q: string) => void; onPrefs: (c: ChannelOut, body: unknown, done?: string) => void; onRead: (c: ChannelOut) => void; onReadAll: () => void; refreshMeta: () => void }) {
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const live = useChatLive();
  const { call } = useChatApi();
  const router = useRouter();
  const mine = meta.channels.filter((c) => c.member && !c.archived && (!onlyUnread || c.unread > 0 || c.id === active));
  const starred = mine.filter((c) => c.starred);
  const channels = mine.filter((c) => !c.starred && c.kind === "channel").sort((a, b) => a.name.localeCompare(b.name));
  const dms = mine.filter((c) => !c.starred && c.kind !== "channel").sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  const me = people.get(meta.me.id);
  const pr = presenceOf(me);
  const section = (key: string, title: string, items: ChannelOut[], add?: () => void) => (
    <div className="mt-3">
      <div className="group flex items-center px-2">
        <button type="button" onClick={() => setClosed({ ...closed, [key]: !closed[key] })} className="flex flex-1 items-center gap-1 py-1 text-[11.5px] font-semibold tracking-wide text-muted uppercase hover:text-fg">
          <ChevronDown className={cx("size-3 transition-transform", closed[key] && "-rotate-90")} />{title}
        </button>
        {add && <button type="button" aria-label={`Add to ${title}`} onClick={add} className="chat-press chat-hover-reveal grid size-6 place-items-center rounded-[7px] text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg focus:opacity-100"><Plus className="size-3.5" /></button>}
      </div>
      {!closed[key] && (
        <ul className="grid gap-px">
          {items.map((c) => {
            const title2 = channelTitle(c, people);
            const unread = c.unread > 0 && c.notify !== "none";
            const typing = (live.typing[c.id] ?? []).some((t) => t.u !== meta.me.id);
            return (
              <li key={c.id} className="group/row relative">
                <Link href={`/chat/${c.id}`} className={cx("flex h-[34px] items-center gap-2.5 rounded-[10px] pr-8 pl-2 text-[13.5px] transition-[background-color,box-shadow,color] duration-150", active === c.id ? "bg-[var(--surface-solid)] font-semibold text-fg shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_var(--border)]" : "text-fg/85 hover:bg-surface-2 hover:text-fg", unread && active !== c.id && "font-semibold text-fg")}>
                  <ConvIcon c={c} people={people} size={20} />
                  <span className={cx("min-w-0 flex-1 truncate", c.notify === "none" && active !== c.id && "text-subtle")}>{title2}</span>
                  {c.requests > 0 && <span title={`${c.requests} ${c.requests === 1 ? "guest is" : "guests are"} waiting to be let in`} className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-teal-600 px-1 text-[10.5px] font-bold text-white tabular-nums">+{c.requests}</span>}
                  {typing && active !== c.id ? <span className="inline-flex items-center gap-[3px]">{[0, 1, 2].map((i) => <span key={i} className="chat-typing-dot size-1 rounded-full bg-muted" style={{ animationDelay: `${i * 0.16}s` }} />)}</span> : c.mentions > 0 ? <span key={c.mentions} className="chat-pop grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10.5px] font-bold text-white tabular-nums shadow-[0_2px_8px_-2px_rgba(239,68,68,0.7)]">{c.mentions}</span> : unread ? <span key={c.unread} className="chat-pop grid h-[18px] min-w-[18px] place-items-center rounded-full bg-fg/10 px-1.5 text-[10.5px] font-semibold text-fg tabular-nums">{c.unread > 99 ? "99+" : c.unread}</span> : c.notify === "none" ? <BellOff className="size-3 text-subtle" /> : null}
                </Link>
                <span className="chat-hover-reveal absolute top-[5px] right-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                  <Menu
                    label="Conversation options"
                    trigger={(p) => <button {...p} type="button" aria-label="Options" className="chat-press grid size-6 place-items-center rounded-[7px] text-muted hover:bg-surface-3 hover:text-fg"><MoreHorizontal className="size-3.5" /></button>}
                    items={[
                      { label: "Mark as read", icon: <CheckCheck />, onSelect: () => onRead(c), disabled: !c.unread },
                      { label: c.starred ? "Unstar" : "Star", icon: <Star />, onSelect: () => onPrefs(c, { starred: !c.starred }) },
                      { label: c.notify === "none" ? "Unmute" : "Mute", icon: c.notify === "none" ? <Bell /> : <BellOff />, onSelect: () => onPrefs(c, { notify: c.notify === "none" ? "all" : "none" }, c.notify === "none" ? "Unmuted" : "Muted") },
                      ...(c.kind !== "channel" ? [{ label: "Hide", icon: <X />, onSelect: () => onPrefs(c, { hidden: true }, "Hidden — it comes back when someone writes") }] : []),
                    ]}
                  />
                </span>
              </li>
            );
          })}
          {!items.length && <li className="px-3 py-1 text-[12px] text-subtle">{onlyUnread ? "Nothing unread" : "None yet"}</li>}
        </ul>
      )}
    </div>
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <button type="button" onClick={onStatus} className="chat-press flex min-w-0 flex-1 items-center gap-2.5 rounded-[14px] p-1.5 text-left hover:bg-surface-2" title="Set your status">
          <Avatar id={meta.me.id} name={meta.me.name} person={me} size={32} />
          <span className="min-w-0"><span className="block truncate text-[13.5px] font-semibold">{meta.me.name}</span><span className="block truncate text-[11.5px] text-muted">{meta.me.emoji} {meta.me.note || pr.label}</span></span>
        </button>
        <Menu
          label="New"
          trigger={(p) => <button {...p} type="button" aria-label="New chat or channel" title="New" className="chat-press grid size-9 place-items-center rounded-[12px] bg-fg text-bg shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)] hover:opacity-90"><MessageSquarePlus className="size-4" /></button>}
          items={[
            { label: "New chat", icon: <MessageSquarePlus />, onSelect: () => onNew("chat") },
            { label: "New channel", icon: <Hash />, onSelect: () => onNew("channel") },
            { label: "Browse channels", icon: <Compass />, onSelect: () => router.push("/chat/browse") },
          ]}
        />
      </div>
      <form className="px-3" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSearch(q.trim()); }}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" aria-label="Search messages" className="h-9 rounded-[11px] bg-[var(--surface-solid)] pl-8 text-[13px]" />
        </div>
      </form>
      <nav className="mt-2 grid gap-px px-2" aria-label="Chat">
        <RailLink href="/chat" icon={<Home />} active={active === "home"} label="Home" />
        <RailLink href="/chat/activity" icon={<AtSign />} active={active === "activity"} label="Activity" count={meta.counts.mentions} hot />
        <RailLink href="/chat/saved" icon={<Bookmark />} active={active === "saved"} label="Saved" count={meta.counts.saved} />
        <RailLink href="/chat/browse" icon={<Compass />} active={active === "browse"} label="Browse channels" />
      </nav>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {starred.length > 0 && section("starred", "Starred", starred)}
        {section("channels", "Channels", channels, () => onNew("channel"))}
        {section("dms", "Direct messages", dms, () => onNew("chat"))}
      </div>
      <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
        <button type="button" onClick={() => setOnlyUnread(!onlyUnread)} aria-pressed={onlyUnread} className={cx("chat-press h-7 rounded-full px-2.5 text-[12px] transition-colors", onlyUnread ? "bg-fg font-medium text-bg" : "text-muted hover:bg-surface-2")}>Unread only</button>
        <button type="button" onClick={onReadAll} disabled={!meta.counts.unread} className="h-7 rounded-full px-2.5 text-[12px] text-muted hover:bg-surface-2 disabled:opacity-40">Mark all read</button>
        {meta.me.admin && <span className="ml-auto"><ImportButton target={target("chat.channels")} label="Import" onImport={(rows, mode) => call<ImportResult>("channels/import", "POST", { rows, mode })} onDone={refreshMeta} /></span>}
      </div>
    </div>
  );
}

function RailLink({ href, icon, label, active, count, hot }: { href: string; icon: React.ReactNode; label: string; active: boolean; count?: number; hot?: boolean }) {
  return (
    <Link href={href} className={cx("flex h-[34px] items-center gap-2.5 rounded-[10px] px-2 text-[13.5px] transition-[background-color,box-shadow] duration-150 [&>svg]:size-4", active ? "bg-[var(--surface-solid)] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_var(--border)] [&>svg]:text-sky-600" : "text-fg/85 hover:bg-surface-2 [&>svg]:text-muted")}>
      {icon}<span className="flex-1">{label}</span>
      {!!count && <span key={count} className={cx("chat-pop grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-bold tabular-nums", hot ? "bg-red-500 text-white" : "text-muted")}>{count}</span>}
    </Link>
  );
}

// ── Pages ───────────────────────────────────────────────────────────────────

function PageHead({ title, sub, onBack, actions }: { title: string; sub?: string; onBack: () => void; actions?: React.ReactNode }) {
  return (
    <header className="chat-glass flex min-h-[64px] items-center gap-2 border-b border-border px-4">
      <button type="button" aria-label="Back" onClick={onBack} className="chat-press grid size-9 place-items-center rounded-full hover:bg-surface-2 @4xl/chat:hidden"><ChevronDown className="size-4 rotate-90" /></button>
      <div className="min-w-0 flex-1"><h1 className="text-[16.5px] font-semibold tracking-[-0.01em]">{title}</h1>{sub && <p className="text-[12px] text-muted">{sub}</p>}</div>
      {actions}
    </header>
  );
}

function useOps(meta: MetaOut, people: Map<string, PersonOut>, channelFor: (m: MessageOut) => ChannelOut | undefined, refresh: () => void) {
  const { call } = useChatApi();
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    (m: MessageOut): Ops => {
      const c = channelFor(m) ?? ({ id: m.channelId, kind: "channel", name: "", people: [], member: true, archived: false, role: null } as unknown as ChannelOut);
      const open = () => router.push(`/chat/${m.channelId}?m=${m.id}${m.parentId ? `&t=${m.parentId}` : ""}`);
      const act = (p: string, method: string, body?: unknown) => void call(p, method, body).then(refresh).catch((e) => toast({ tone: "error", title: errorMessage(e) }));
      return {
        me: meta.me.id, people, channel: c, admin: meta.me.admin,
        react: (x, emoji, on) => act(`messages/${x.id}/react`, "POST", { emoji, on }),
        reply: open, edit: open, remove: open, forward: open, task: open, remind: open, emojiPicker: open,
        pin: (x, on) => act(`messages/${x.id}/pin`, on ? "POST" : "DELETE"),
        save: (x, on) => act(`messages/${x.id}/save`, "POST", { on }),
        unread: (x) => act(`channels/${x.channelId}/read`, "POST", { unreadFrom: x.seq }),
        email: null,
        vote: (x, choice, on, note) => act(`messages/${x.id}/vote`, "POST", { choice, on, note: note ?? "" }),
        settle: (x, state) => act(`messages/${x.id}/settle`, "POST", { state }),
        approve: (x, choice) => (choice === "approve" ? act(`messages/${x.id}/vote`, "POST", { choice }) : open()),
        calendar: (x) => act(`messages/${x.id}/calendar`, "POST", {}),
        tag: (t) => router.push(`/chat/search?q=${encodeURIComponent(`tag:${t}`)}`),
        copyLink: (x) => void copyText(`${location.origin}/chat/${x.channelId}?m=${x.id}`).then((ok) => toast(ok ? { tone: "success", title: "Link copied" } : { tone: "error", title: "Couldn't copy — your browser blocked it" })),
      };
    },
    [meta, people, channelFor, call, refresh, router, toast],
  );
}

function Hit({ m, ops, where, onOpen, note }: { m: MessageOut; ops: Ops; where: string; onOpen: () => void; note?: React.ReactNode }) {
  const { base } = useChatApi();
  return (
    <div className="border-b border-border py-1.5">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 px-5 pt-1 text-left text-[12px] text-muted hover:text-fg">
        <span className="font-semibold text-fg">{where}</span>{note}<span className="ml-auto">{shortWhen(m.createdAt)}</span>
      </button>
      {/* Opening the conversation is for clicks on the message itself — reactions, votes and menus inside still work. */}
      <div className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, input, label, textarea, select, [role=menu], [role=dialog]")) onOpen(); }}><Message m={m} ops={ops} compact={false} base={base} inThread /></div>
    </div>
  );
}

const whereOf = (c: { kind: string; name: string } | undefined, people: Map<string, PersonOut>, ch?: ChannelOut) => (ch ? (ch.kind === "channel" ? `#${ch.name}` : channelTitle(ch, people)) : c?.kind === "channel" ? `#${c.name}` : c?.name || "Direct message");

function HomeView({ meta, people, onOpen, onNew }: { meta: MetaOut; people: Map<string, PersonOut>; onOpen: (id: string) => void; onNew: (k: "channel" | "chat") => void }) {
  const unread = meta.channels.filter((c) => c.member && c.unread > 0 && c.notify !== "none").sort((a, b) => b.mentions - a.mentions || (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  const online = meta.people.filter((p) => p.id !== meta.me.id && (p.online || p.inMeeting));
  const hour = new Date().getHours();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <p className="text-[13px] text-muted">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="mt-0.5 text-[26px] font-semibold tracking-tight">{hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, {meta.me.name.split(" ")[0]}</h1>
        <p className="mt-1 text-[14px] text-muted">{unread.length ? `${meta.counts.unread} unread in ${unread.length} ${unread.length === 1 ? "conversation" : "conversations"}${meta.counts.mentions ? ` · ${meta.counts.mentions} need${meta.counts.mentions === 1 ? "s" : ""} you` : ""}.` : "You're all caught up."}</p>
        <div className="mt-6 grid gap-4 @3xl/chat:grid-cols-[minmax(0,1fr)_280px]">
          <section className="chat-msg-in rounded-[20px] border border-border bg-[var(--surface-solid)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-24px_rgba(0,0,0,0.25)]">
            <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><Inbox className="size-4" />Waiting for you</h2>
            {unread.length === 0 ? (
              <div className="grid place-items-center py-10 text-center"><CircleCheck className="size-8 text-emerald-500" /><p className="mt-2 text-[14px] font-medium">Nothing unread</p><p className="text-[12.5px] text-muted">New messages show here, the ones that mention you first.</p></div>
            ) : (
              <ul className="grid gap-1">
                {unread.slice(0, 12).map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpen(c.id)} className="chat-press flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-surface-2">
                      <ConvIcon c={c} people={people} size={34} />
                      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-[14px] font-semibold">{channelTitle(c, people)}</span>{c.mentions > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10.5px] font-bold text-white">@{c.mentions}</span>}</span><span className="block truncate text-[12.5px] text-muted">{c.lastPreview}</span></span>
                      <span className="text-right"><span className="block text-[11.5px] text-subtle">{c.lastMessageAt ? shortWhen(c.lastMessageAt) : ""}</span><span className="text-[12px] font-semibold tabular-nums">{c.unread} new</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {meta.ai && unread.some((c) => c.unread >= 5 && c.ai) && <p className="mt-3 flex items-center gap-1.5 rounded-[12px] bg-violet-500/8 px-3 py-2 text-[12.5px] text-violet-800 dark:text-violet-200"><Sparkles className="size-3.5" />Lots to read? Open a conversation and press ✨ for an AI catch-up — decisions, action items and what&apos;s asked of you.</p>}
          </section>
          <div className="grid content-start gap-4">
            <section className="chat-msg-in rounded-[20px] border border-border bg-[var(--surface-solid)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-24px_rgba(0,0,0,0.25)]">
              <h2 className="mb-2 text-[14px] font-semibold">Start something</h2>
              <div className="grid gap-1.5">
                <Button icon={<MessageSquarePlus className="size-3.5" />} onClick={() => onNew("chat")}>New chat</Button>
                <Button icon={<Hash className="size-3.5" />} onClick={() => onNew("channel")}>New channel</Button>
              </div>
              <KeyboardOnly><p className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11.5px] text-muted">Tip: <Keys k="mod+j" /> jumps to any conversation; <Keys k="alt+up / alt+down" /> moves between them.</p></KeyboardOnly>
            </section>
            <section className="chat-msg-in rounded-[20px] border border-border bg-[var(--surface-solid)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-24px_rgba(0,0,0,0.25)]">
              <h2 className="mb-2 text-[14px] font-semibold">Around now <span className="font-normal text-muted">({online.length})</span></h2>
              {online.length === 0 ? <p className="text-[12.5px] text-muted">Nobody else is online right now.</p> : (
                <ul className="grid gap-1">
                  {online.slice(0, 10).map((p) => <PersonRow key={p.id} p={p} />)}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonRow({ p }: { p: PersonOut }) {
  const { call } = useChatApi();
  const router = useRouter();
  return (
    <li>
      <button type="button" onClick={() => void call<{ channel: { id: string } }>(`dm/${p.id}`, "POST").then((r) => router.push(`/chat/${r.channel.id}`))} className="flex w-full items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left hover:bg-surface-2">
        <Avatar id={p.id} name={p.name} person={p} size={28} />
        <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{p.name}</span><span className="block truncate text-[11.5px] text-muted">{p.inMeeting ? "In a meeting" : p.note ? `${p.emoji} ${p.note}` : STATUS_LABEL[p.status]}</span></span>
      </button>
    </li>
  );
}

function ActivityView({ meta, people, onBack }: { meta: MetaOut; people: Map<string, PersonOut>; onBack: () => void }) {
  const { call, orgId } = useChatApi();
  const live = useChatLive();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | ActivityItem["kind"]>("all");
  const r = useQuery({ queryKey: chatKey(orgId, "activity"), queryFn: () => call<{ items: ActivityItem[] }>("activity") });
  const { refetch } = r;
  useEffect(() => live.on((e) => e.type === "m" && void refetch()), [live, refetch]);
  const chans = useMemo(() => new Map(meta.channels.map((c) => [c.id, c])), [meta.channels]);
  const opsFor = useOps(meta, people, (m) => chans.get(m.channelId), () => void refetch());
  const items = (r.data?.items ?? []).filter((i) => filter === "all" || i.kind === filter);
  const label: Record<ActivityItem["kind"], string> = { mention: "mentioned you", reply: "replied", reaction: "reacted", dm: "messaged you", reminder: "reminder" };
  return (
    <div className="flex h-full flex-col">
      <PageHead title="Activity" sub="Mentions, replies to your threads, reactions and direct messages — last 30 days" onBack={onBack} />
      <div className="flex gap-1 border-b border-border px-4 py-2">
        {(["all", "mention", "reply", "dm", "reaction"] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={cx("h-7 rounded-full px-2.5 text-[12px]", filter === f ? "bg-fg font-medium text-bg" : "border border-border hover:bg-surface-2")}>{{ all: "All", mention: "Mentions", reply: "Replies", dm: "Direct", reaction: "Reactions" }[f]}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {r.isLoading ? <div className="grid gap-3 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div> : !items.length ? (
          <div className="grid h-full place-items-center p-8 text-center"><div><AtSign className="mx-auto size-8 text-subtle" /><p className="mt-2 text-[15px] font-semibold">Nothing here yet</p><p className="text-[13px] text-muted">When someone mentions you, replies to you or messages you, it shows here.</p></div></div>
        ) : items.map((i, n) => (
          <div key={`${i.message.id}-${i.kind}-${n}`} className={cx(i.unread && "bg-sky-500/[0.04]")}>
            <Hit m={i.message} ops={opsFor(i.message)} where={whereOf(i.channel, people, chans.get(i.channel.id))} note={<span className="text-subtle">· {i.kind === "reaction" ? `${people.get(i.message.reactions[0]?.users[0] ?? "")?.name ?? "Someone"} reacted ${i.message.reactions[0]?.emoji}` : label[i.kind]}{i.unread && <b className="ml-1.5 text-sky-600">• new</b>}</span>} onOpen={() => router.push(`/chat/${i.message.channelId}?m=${i.message.id}${i.message.parentId ? `&t=${i.message.parentId}` : ""}`)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SavedView({ meta, people, onBack }: { meta: MetaOut; people: Map<string, PersonOut>; onBack: () => void }) {
  const { call, orgId } = useChatApi();
  const router = useRouter();
  const r = useQuery({ queryKey: chatKey(orgId, "saved"), queryFn: () => call<{ saved: { message: MessageOut; remindAt: string | null; done: boolean; savedAt: string }[] }>("saved") });
  const chans = useMemo(() => new Map(meta.channels.map((c) => [c.id, c])), [meta.channels]);
  const opsFor = useOps(meta, people, (m) => chans.get(m.channelId), () => void r.refetch());
  const [tab, setTab] = useState<"open" | "done">("open");
  const list = (r.data?.saved ?? []).filter((s) => (tab === "done" ? s.done : !s.done));
  return (
    <div className="flex h-full flex-col">
      <PageHead title="Saved" sub="Messages you kept for later, with their reminders" onBack={onBack} />
      <div className="flex gap-1 border-b border-border px-4 py-2">
        {(["open", "done"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cx("h-7 rounded-full px-2.5 text-[12px]", tab === t ? "bg-fg font-medium text-bg" : "border border-border hover:bg-surface-2")}>{t === "open" ? "In progress" : "Done"}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {r.isLoading ? <div className="p-5"><Skeleton className="h-20" /></div> : !list.length ? (
          <div className="grid h-full place-items-center p-8 text-center"><div><Bookmark className="mx-auto size-8 text-subtle" /><p className="mt-2 text-[15px] font-semibold">{tab === "open" ? "Nothing saved" : "Nothing done yet"}</p><p className="text-[13px] text-muted">Hover a message and press the bookmark — or “Remind me about this” in its ⋯ menu.</p></div></div>
        ) : list.map((s) => (
          <Hit
            key={s.message.id}
            m={s.message}
            ops={opsFor(s.message)}
            where={whereOf(undefined, people, chans.get(s.message.channelId))}
            note={<>{s.remindAt && <span className={cx("inline-flex items-center gap-1 rounded-full px-1.5 text-[11px]", new Date(s.remindAt) < new Date() ? "bg-red-500/10 text-red-600" : "bg-sky-500/10 text-sky-700 dark:text-sky-300")}><Clock3 className="size-3" />{new Date(s.remindAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>}<button type="button" onClick={(e) => { e.stopPropagation(); void call(`messages/${s.message.id}/save`, "POST", { done: !s.done, remindAt: null }).then(() => r.refetch()); }} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 text-[11px] hover:bg-surface-2">{s.done ? <><BookmarkCheck className="size-3" />Not done</> : <><CheckCheck className="size-3" />Done</>}</button></>}
            onOpen={() => router.push(`/chat/${s.message.channelId}?m=${s.message.id}${s.message.parentId ? `&t=${s.message.parentId}` : ""}`)}
          />
        ))}
      </div>
    </div>
  );
}

function SearchView({ meta, people, q, onBack }: { meta: MetaOut; people: Map<string, PersonOut>; q: string; onBack: () => void }) {
  const { call, orgId } = useChatApi();
  const router = useRouter();
  const [text, setText] = useState(q);
  const r = useQuery({ queryKey: chatKey(orgId, "search", q), queryFn: () => call<{ messages: MessageOut[] }>(`search?q=${encodeURIComponent(q)}`), enabled: !!q });
  const chans = useMemo(() => new Map(meta.channels.map((c) => [c.id, c])), [meta.channels]);
  const opsFor = useOps(meta, people, (m) => chans.get(m.channelId), () => void r.refetch());
  const chips = ["from:me", "has:file", "has:link", "has:decision", "has:poll", "is:pinned", "is:saved", "is:urgent"];
  return (
    <div className="flex h-full flex-col">
      <PageHead title="Search" onBack={onBack} />
      <form className="border-b border-border px-4 py-3" onSubmit={(e) => { e.preventDefault(); router.push(`/chat/search?q=${encodeURIComponent(text.trim())}`); }}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search — words, from:name, in:channel, has:file, tag:topic, after:2026-10-01" className="pl-9" aria-label="Search" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => <button key={c} type="button" onClick={() => router.push(`/chat/search?q=${encodeURIComponent(`${text.replace(new RegExp(`\\b${c}\\b`), "").trim()} ${c}`.trim())}`)} className={cx("rounded-full border px-2 py-0.5 text-[11.5px] font-medium", text.includes(c) ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-border hover:bg-surface-2")}>{c}</button>)}
        </div>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!q ? <p className="p-6 text-center text-[13px] text-muted">Search every conversation you can read.</p> : r.isLoading ? <div className="p-5"><Skeleton className="h-20" /></div> : !(r.data?.messages.length) ? (
          <p className="p-6 text-center text-[13px] text-muted">Nothing matches “{q}”.</p>
        ) : (
          <>
            <p className="px-5 pt-3 text-[12px] text-muted">{r.data.messages.length}{r.data.messages.length === 60 ? "+" : ""} results</p>
            {r.data.messages.map((m) => <Hit key={m.id} m={m} ops={opsFor(m)} where={whereOf(undefined, people, chans.get(m.channelId))} onOpen={() => router.push(`/chat/${m.channelId}?m=${m.id}${m.parentId ? `&t=${m.parentId}` : ""}`)} />)}
          </>
        )}
      </div>
    </div>
  );
}

function BrowseView({ meta, onBack, onOpen, refreshMeta }: { meta: MetaOut; onBack: () => void; onOpen: (id: string) => void; refreshMeta: () => void }) {
  const { call } = useChatApi();
  const toast = useToast();
  const [q, setQ] = useState("");
  const list = meta.channels.filter((c) => c.kind === "channel" && (c.visibility === "public" || c.member) && `${c.name} ${c.topic}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(a.member) - Number(b.member) || b.memberCount - a.memberCount);
  return (
    <div className="flex h-full flex-col">
      <PageHead title="Browse channels" sub={`${list.length} channels you can see`} onBack={onBack} />
      <div className="border-b border-border px-4 py-3"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a channel" aria-label="Find a channel" /></div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-3">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-[14px] px-3 py-2.5 hover:bg-surface-2">
            <span className="grid size-10 place-items-center rounded-[12px] text-[17px] text-white" style={{ background: c.color }}>{c.emoji || (c.visibility === "private" ? <Lock className="size-4" /> : <Hash className="size-4" />)}</span>
            <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 flex-1 text-left"><span className="flex items-center gap-1.5 text-[14px] font-semibold">#{c.name}{c.archived && <span className="rounded-full bg-surface-2 px-1.5 text-[10.5px] text-muted">Archived</span>}</span><span className="block truncate text-[12.5px] text-muted">{c.memberCount} members{c.topic ? ` · ${c.topic}` : ""}</span></button>
            {c.member ? <span className="text-[12px] font-medium text-muted">Joined</span> : <Button size="sm" onClick={() => void call(`channels/${c.id}/join`, "POST").then(() => { refreshMeta(); onOpen(c.id); }).catch((e) => toast({ tone: "error", title: errorMessage(e) }))}>Join</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Switcher({ meta, people, onClose, onPick }: { meta: MetaOut; people: Map<string, PersonOut>; onClose: () => void; onPick: (id: string) => void }) {
  const { call } = useChatApi();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const items = useMemo(() => {
    const lq = q.toLowerCase();
    const convs = meta.channels.filter((c) => c.member || c.visibility === "public").map((c) => ({ id: c.id, label: channelTitle(c, people), c }));
    const dmless = meta.people.filter((p) => p.id !== meta.me.id && !meta.channels.some((c) => c.kind === "dm" && c.people[0] === p.id)).map((p) => ({ id: `person:${p.id}`, label: p.name, p }));
    return [...convs, ...dmless].filter((x) => x.label.toLowerCase().includes(lq)).slice(0, 12);
  }, [q, meta, people]);
  const pick = async (x: (typeof items)[number]) => {
    if ("p" in x && x.p) {
      const r = await call<{ channel: { id: string } }>(`dm/${x.p.id}`, "POST");
      return onPick(r.channel.id);
    }
    onPick(x.id);
  };
  return (
    <Dialog open onClose={onClose} size="md" title="Jump to">
      <Input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, items.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); } if (e.key === "Enter" && items[hi]) void pick(items[hi]!); }} placeholder="A channel, chat or person" aria-label="Jump to" />
      <ul className="mt-2 grid gap-0.5">
        {items.map((x, i) => (
          <li key={x.id}>
            <button type="button" onMouseEnter={() => setHi(i)} onClick={() => void pick(x)} className={cx("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-[13.5px]", i === hi && "bg-surface-2")}>
              {"c" in x && x.c ? <ConvIcon c={x.c} people={people} size={22} /> : <Avatar id={(x as { p: PersonOut }).p.id} name={x.label} person={(x as { p: PersonOut }).p} size={22} />}
              <span className="flex-1 truncate">{"c" in x && x.c?.kind === "channel" ? `#${x.label}` : x.label}</span>
              {"c" in x && x.c && x.c.unread > 0 && <span className="text-[11px] text-muted">{x.c.unread} new</span>}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

