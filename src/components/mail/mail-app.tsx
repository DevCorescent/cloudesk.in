"use client";

// Mail: one inbox for every connected mailbox. Left, the mailboxes, smart
// views, categories and labels; middle, the conversations (search with
// operators, category tabs, multi-select and bulk actions); right, the open
// conversation. The panes follow the space Mail actually has (the app sidebar
// may be open or not): three panes when wide, list + conversation in the
// middle (mailboxes in a drawer), one at a time on phones. Keyboard first: press ?.
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { AlarmClock, Archive, ArrowDownToLine, AtSign, BarChart3, BellOff, BellRing, Brush, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Clock, Inbox, Keyboard, Loader2, Mail, MailOpen, MessageSquareReply, Paperclip, PenSquare, Pin, Plus, RefreshCw, Search, Send, Settings, ShieldAlert, SlidersHorizontal, Sparkles, Star, Tag, Trash2, TriangleAlert, UserRound, Users, Video, X, Repeat, Maximize2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Badge, Button, EmptyState, ErrorState, IconButton, Skeleton, cx } from "@/components/ui/primitives";
import { KeyboardOnly, Keys, useShortcuts } from "@/components/ui/shortcut";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import type { BulkIn, MetaOut, ThreadRow, ThreadsOut } from "@/lib/mail/api";
import { CATEGORIES, CATEGORY_LABEL, parseSearch, REPLY_CATEGORIES, slaState, type Category, type View } from "@/lib/mail/model";
import { Composer } from "./compose";
import { ConnectWizard, MailWelcome } from "./connect";
import { MailSettings, ShortcutList } from "./settings";
import { accountOf, Avatar, mailKey, personName, presets, shortTime, typing, UndoProvider, useMailApi, useMailMeta, useMailRefresh } from "./shared";
import { FindMeetingsButton } from "@/components/calendar/find-meetings";
import { fmtMinutes, MailAnalytics } from "./analytics";
import { SenderCleanup } from "./cleanup";
import { MailContacts } from "./contacts";
import { PrintThread, ThreadView } from "./thread";
import type { ComposeMode } from "./compose";
import { RecurringMail } from "./recurring";
import { FullscreenReader, useReaderZoom } from "./reader";

const VIEW_META: { id: View; label: string; icon: ReactNode }[] = [
  { id: "inbox", label: "Inbox", icon: <Inbox /> },
  { id: "needsreply", label: "Needs reply", icon: <MessageSquareReply /> },
  { id: "meetings", label: "Meetings", icon: <Video /> },
  { id: "important", label: "Important", icon: <TriangleAlert /> },
  { id: "starred", label: "Starred", icon: <Star /> },
  { id: "snoozed", label: "Snoozed", icon: <AlarmClock /> },
  { id: "waiting", label: "Waiting for reply", icon: <Clock /> },
  { id: "followups", label: "Follow-ups due", icon: <BellRing /> },
  { id: "scheduled", label: "Scheduled", icon: <CalendarClock /> },
  { id: "sent", label: "Sent", icon: <Send /> },
  { id: "attachments", label: "Attachments", icon: <Paperclip /> },
  { id: "archive", label: "Archive", icon: <Archive /> },
  { id: "spam", label: "Spam", icon: <ShieldAlert /> },
  { id: "trash", label: "Trash", icon: <Trash2 /> },
  { id: "assigned", label: "Assigned to me", icon: <UserRound /> },
  { id: "muted", label: "Muted", icon: <BellOff /> },
];

const OPERATORS: [string, string][] = [
  ["from:", "sender name or address"],
  ["to:", "recipient"],
  ["subject:", "words in the subject"],
  ["has:attachment", "with files"],
  ["is:unread", "not read yet"],
  ["is:starred", "starred"],
  ["label:", "a label"],
  ["category:", "finance, people, updates…"],
  ["before:", "YYYY-MM-DD"],
  ["after:", "YYYY-MM-DD"],
];

export function MailApp({ path }: { path: string[] }) {
  return (
    <UndoProvider>
      <MailRoot path={path} />
    </UndoProvider>
  );
}

function MailRoot({ path }: { path: string[] }) {
  const meta = useMailMeta();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [wizard, setWizard] = useState(false);
  const notified = useRef(false);
  useEffect(() => {
    if (notified.current) return;
    const ok = params.get("connected");
    const err = params.get("error");
    if (ok || err) {
      notified.current = true;
      toast(ok ? { tone: "success", title: "Mailbox connected", description: "Your mail is syncing now." } : { tone: "error", title: "Couldn't connect the mailbox", description: err ?? undefined });
      router.replace("/mail");
    }
  }, [params, router, toast]);

  if (meta.isError) {
    const forbidden = meta.error instanceof ApiClientError && meta.error.status === 403;
    return forbidden ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <Mail className="mx-auto size-6 text-muted" />
        <h1 className="mt-3 text-lg font-semibold">Mail isn&apos;t open to you</h1>
        <p className="mt-1 text-[13px] text-muted">{errorMessage(meta.error)}</p>
        <Link href="/settings/features" className="mt-4 inline-flex text-[13px] font-medium underline">Open Features</Link>
      </div>
    ) : (
      <div className="p-8"><ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} /></div>
    );
  }
  if (!meta.data)
    return (
      <div className="@container/mail h-[var(--app-h)]">
        <div className="grid h-full grid-cols-1 gap-3 p-3 @3xl/mail:grid-cols-[minmax(290px,340px)_minmax(0,1fr)] @6xl/mail:grid-cols-[220px_minmax(320px,380px)_minmax(0,1fr)]">
          <Skeleton className="hidden rounded-[16px] @6xl/mail:block" />
          <Skeleton className="rounded-[16px]" />
          <Skeleton className="hidden rounded-[16px] @3xl/mail:block" />
        </div>
      </div>
    );
  const m = meta.data;
  const wiz = wizard && <ConnectWizard meta={m} onClose={() => setWizard(false)} onConnected={() => router.push("/mail")} />;
  if (path[0] === "settings") return <>{<MailSettings meta={m} onAdd={() => setWizard(true)} />}{wiz}</>;
  if (!m.accounts.length) return <>{<MailWelcome onConnect={() => setWizard(true)} canOauth={m.oauth.google || m.oauth.microsoft} />}{wiz}</>;
  if (path[0] === "analytics") return <MailAnalytics meta={m} />;
  if (path[0] === "cleanup") return <SenderCleanup meta={m} />;
  if (path[0] === "contacts") return <MailContacts />;
  if (path[0] === "recurring") return <RecurringMail meta={m} />;
  if (path[0] === "print" && path[1]) return <PrintThread id={path[1]} />;
  // /mail/t/<id> (links in notifications and analytics) opens that conversation.
  return <><Inbox3 meta={m} onAdd={() => setWizard(true)} initialOpen={path[0] === "t" ? path[1] ?? null : null} />{wiz}</>;
}

type ListData = InfiniteData<ThreadsOut, string | null>;

function Inbox3({ meta, onAdd, initialOpen }: { meta: MetaOut; onAdd: () => void; initialOpen: string | null }) {
  const { keyboard } = useShortcuts();
  const { orgId, base, call } = useMailApi();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = useMailRefresh();
  const [account, setAccount] = useState<string>("all");
  const [view, setView] = useState<View>("inbox");
  const [category, setCategory] = useState<Category | "all">("all");
  const [label, setLabel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [cursor, setCursor] = useState(0);
  // Full-screen reading: open, on its way out (for the exit animation), or off; and which way the last move went.
  const [full, setFull] = useState<false | "open" | "closing">(false);
  const [noteReq, setNoteReq] = useState<{ n: number; id: string } | null>(null);
  const [dir, setDir] = useState<"next" | "prev" | "none">("none");
  const [zoom, setZoom] = useReaderZoom();
  if (!open && full) setFull(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [compose, setCompose] = useState(false);
  const [help, setHelp] = useState(false);
  const [hints, setHints] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [replyReq, setReplyReq] = useState<{ mode: ComposeMode; n: number; id: string } | null>(null);
  const [briefing, setBriefing] = useState<{ busy: boolean; text: string | null; error: string | null } | null>(null);
  const [snoozeIds, setSnoozeIds] = useState<string[] | null>(null);
  const [labelIds, setLabelIds] = useState<string[] | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const anyShared = meta.accounts.some((a) => a.shared);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ account, view, ...(view === "inbox" && category !== "all" ? { category } : {}), ...(label ? { label } : {}), ...(query ? { q: query } : {}) });
  const listKey = mailKey(orgId, "threads", params.toString());
  const list = useInfiniteQuery({
    queryKey: listKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => call<ThreadsOut>(`threads?${params.toString()}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.next,
    refetchInterval: 30_000,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.threads) ?? [], [list.data]);
  const counts = meta.counts[account] ?? meta.counts.all;

  // Optimistic edits to the rows on screen; refreshed from the server after.
  const edit = useCallback(
    (ids: string[], fn: (t: ThreadRow) => ThreadRow | null) => {
      const prev = qc.getQueryData<ListData>(listKey);
      qc.setQueryData<ListData>(listKey, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, threads: p.threads.flatMap((t) => (ids.includes(t.id) ? (fn(t) ? [fn(t)!] : []) : [t])) })) } : d));
      return () => qc.setQueryData(listKey, prev);
    },
    [qc, listKey],
  );
  const leaves = (a: BulkIn["action"]) => ["archive", "trash", "spam", "snooze"].includes(a) || (a === "inbox" && view !== "inbox");
  const bulk = async (ids: string[], action: BulkIn["action"], value?: string, done?: string) => {
    if (!ids.length) return;
    const undoEdit = edit(ids, (t) => {
      if (leaves(action)) return null;
      if (action === "read") return { ...t, unread: 0 };
      if (action === "unread") return { ...t, unread: Math.max(1, t.unread) };
      if (action === "star") return { ...t, starred: true };
      if (action === "unstar") return { ...t, starred: false };
      if (action === "label" && value) return { ...t, labels: [...new Set([...t.labels, value])] };
      if (action === "category" && value) return { ...t, category: value as Category };
      return t;
    });
    if (leaves(action) && open && ids.includes(open)) setOpen(null);
    try {
      await call("threads/bulk", "POST", { ids, action, value } satisfies BulkIn);
      if (done) toast({ tone: "success", title: done });
      setSelected(new Set());
    } catch (e) {
      undoEdit();
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      void refresh();
    }
  };

  const targetIds = () => (selected.size ? [...selected] : rows[cursor] ? [rows[cursor]!.id] : []);
  const at = open ? rows.findIndex((r) => r.id === open) : -1;
  const openFull = () => {
    setDir("none");
    setFull("open");
  };
  const closeFull = () => {
    if (full !== "open") return;
    setFull("closing");
    setTimeout(() => setFull((f) => (f === "closing" ? false : f)), 180);
  };
  const step = (by: 1 | -1) => {
    const i = (at < 0 ? cursor : at) + by;
    if (i < 0 || i >= rows.length) return;
    setDir(by > 0 ? "next" : "prev");
    openRow(i);
  };
  // Archived, trashed or snoozed while reading full screen: on to the next one (or the one before), like turning a page.
  const advance = () => {
    const nxt = rows[at + 1] ? at + 1 : rows[at - 1] ? at - 1 : -1;
    if (nxt < 0 || at < 0) {
      setOpen(null);
      return;
    }
    setDir(nxt > at ? "next" : "prev");
    const t = rows[nxt]!;
    setOpen(t.id);
    setCursor(nxt > at ? at : nxt);
    if (t.unread) edit([t.id], (x) => ({ ...x, unread: 0 }));
  };
  const openRow = (i: number) => {
    const t = rows[i];
    if (!t) return;
    setCursor(i);
    setOpen(t.id);
    if (t.unread) edit([t.id], (x) => ({ ...x, unread: 0 }));
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const k = e.key;
      // Full screen: Esc leaves it, the arrows (and j / k) turn the pages, v toggles it.
      if (full === "open" && k === "Escape") return void (e.preventDefault(), closeFull());
      if (full === "open" && (k === "ArrowRight" || k === "ArrowLeft")) return void (e.preventDefault(), step(k === "ArrowRight" ? 1 : -1));
      if (k === "v" && open) return void (e.preventDefault(), full === "open" ? closeFull() : openFull());
      if (full === "open" && (k === "j" || k === "k")) return void (e.preventDefault(), step(k === "j" ? 1 : -1));
      const cur = rows[cursor];
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (k === "j") act(() => (open ? openRow(Math.min(cursor + 1, rows.length - 1)) : setCursor(Math.min(cursor + 1, rows.length - 1))));
      else if (k === "k") act(() => (open ? openRow(Math.max(cursor - 1, 0)) : setCursor(Math.max(cursor - 1, 0))));
      else if (k === "Enter" || k === "o") act(() => openRow(cursor));
      else if (k === "e") act(() => void bulk(targetIds(), view === "archive" ? "inbox" : "archive", undefined, view === "archive" ? "Moved to inbox" : "Archived"));
      else if (k === "#") act(() => void bulk(targetIds(), "trash", undefined, "Moved to trash"));
      else if (k === "s" && cur) act(() => void bulk(selected.size ? [...selected] : [cur.id], cur.starred ? "unstar" : "star"));
      else if (k === "u") act(() => {
        void bulk(targetIds(), "unread");
        setOpen(null);
      });
      else if ((k === "r" || k === "a" || k === "f") && open) act(() => setReplyReq({ mode: k === "r" ? "reply" : k === "a" ? "replyAll" : "forward", n: Date.now(), id: open }));
      else if (k === "n" && open) act(() => setNoteReq({ n: Date.now(), id: open }));
      else if (k === "c") act(() => setCompose(true));
      else if (k === "/") act(() => search.current?.focus());
      else if (k === "x" && cur) act(() => setSelected((s) => {
        const n = new Set(s);
        if (n.has(cur.id)) n.delete(cur.id);
        else n.add(cur.id);
        return n;
      }));
      else if (k === "l") act(() => setLabelIds(targetIds()));
      else if (k === "b") act(() => setSnoozeIds(targetIds()));
      else if (k === "?") act(() => setHelp(true));
      else if (k === "Escape") act(() => (selected.size ? setSelected(new Set()) : setOpen(null)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Load more when the end of the list comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage && void list.fetchNextPage(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  const choose = (patch: { account?: string; view?: View; category?: Category | "all"; label?: string | null }) => {
    if (patch.account !== undefined) setAccount(patch.account);
    if (patch.view !== undefined) setView(patch.view);
    setCategory(patch.category ?? (patch.view && patch.view !== "inbox" ? "all" : category));
    setLabel(patch.label === undefined ? (patch.view || patch.account ? null : label) : patch.label);
    setSelected(new Set());
    setOpen(null);
    setCursor(0);
    setRailOpen(false);
  };

  const getBriefing = async () => {
    setBriefing({ busy: true, text: null, error: null });
    try {
      const r = await call<{ briefing: string }>("ai/briefing", "POST", { account });
      setBriefing({ busy: false, text: r.briefing, error: null });
    } catch (e) {
      setBriefing({ busy: false, text: null, error: e instanceof ApiClientError && e.code === "provider_not_configured" ? "The briefing needs an AI provider — an owner can add one in Settings → AI providers." : errorMessage(e) });
    }
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const viewLabel = label ? `Label: ${label}` : VIEW_META.find((v) => v.id === view)?.label ?? "Inbox";

  const rail = (
    <nav aria-label="Mailboxes" className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto p-3">
      <Button variant="primary" size="lg" className="mb-3 w-full" icon={<PenSquare className="size-4" />} onClick={() => { setRailOpen(false); setCompose(true); }}>Compose</Button>
      <RailItem active={account === "all"} onClick={() => choose({ account: "all" })} icon={<Mail />} label="All inboxes" count={meta.counts.all?.unread} />
      {meta.accounts.map((a) => (
        <RailItem key={a.id} active={account === a.id} onClick={() => choose({ account: a.id })} icon={<span className="block size-2.5 rounded-full" style={{ background: a.color }} />} label={a.name} sub={a.shared ? "Team" : undefined} count={meta.counts[a.id]?.unread} status={a.status} />
      ))}
      <button type="button" onClick={onAdd} className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"><Plus className="size-4" /> Add mailbox</button>
      <Link href="/mail/contacts" className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"><Users className="size-4" /> Contacts &amp; groups</Link>
      <Link href="/mail/recurring" className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"><Repeat className="size-4" /> Recurring emails</Link>
      <p className="mt-4 px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.12em] text-subtle uppercase">Views</p>
      {VIEW_META.filter((v) => (v.id !== "assigned" || anyShared) && (v.id !== "muted" || !!counts?.muted || view === "muted")).map((v) => (
        <RailItem key={v.id} active={view === v.id && !label} onClick={() => choose({ view: v.id, label: null })} icon={v.icon} label={v.label} count={v.id === "inbox" ? counts?.inbox : v.id === "needsreply" ? counts?.needsReply : v.id === "meetings" ? counts?.meetings : v.id === "snoozed" ? counts?.snoozed : v.id === "waiting" ? counts?.waiting : v.id === "followups" ? counts?.followups : v.id === "scheduled" ? counts?.scheduled : v.id === "assigned" ? counts?.assigned : v.id === "muted" ? counts?.muted : undefined} alert={v.id === "needsreply" ? counts?.overdue : undefined} muted={v.id !== "inbox" && v.id !== "needsreply" && !(v.id === "meetings" && !!counts?.meetings)} />
      ))}
      {meta.labels.length > 0 && (
        <>
          <p className="mt-3 px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.12em] text-subtle uppercase">Labels</p>
          {meta.labels.map((l) => <RailItem key={l} active={label === l} onClick={() => choose({ view: "inbox", label: l, category: "all" })} icon={<Tag />} label={l} />)}
        </>
      )}
      <p className="mt-4 px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.12em] text-subtle uppercase">Insights</p>
      <Link href="/mail/analytics" className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"><BarChart3 className="size-4" /> Analytics</Link>
      <Link href="/mail/cleanup" className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"><Brush className="size-4" /> Clean up senders</Link>
      <div className="mt-auto pt-3">
        <Link href="/mail/settings" className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"><Settings className="size-4" /> Settings</Link>
        <KeyboardOnly><button type="button" onClick={() => setHelp(true)} className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"><Keyboard className="size-4" /> Shortcuts <Keys k="?" /></button></KeyboardOnly>
      </div>
    </nav>
  );

  return (
    <div className="@container/mail relative h-[var(--app-h)] min-h-[480px] overflow-hidden">
    <div className="grid h-full grid-cols-1 @3xl/mail:grid-cols-[minmax(290px,340px)_minmax(0,1fr)] @6xl/mail:grid-cols-[220px_minmax(320px,380px)_minmax(0,1fr)]">
      {/* Rail */}
      <aside className="hidden min-h-0 border-r border-border @6xl/mail:block">{rail}</aside>
      {railOpen && (
        <div className="fixed inset-0 z-40 @6xl/mail:hidden" role="dialog" aria-label="Mailboxes">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={() => setRailOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[284px] max-w-[85vw] border-r border-border bg-[var(--surface-solid)] shadow-2xl">{rail}</div>
        </div>
      )}

      {/* List */}
      <section aria-label="Conversations" className={cx("min-h-0 min-w-0 flex-col border-r border-border bg-[var(--surface-solid)]/40", open ? "hidden @3xl/mail:flex" : "flex")}>
        <div className="shrink-0 border-b border-border px-3 pt-3">
          {selected.size ? (
            <div className="flex h-9 items-center gap-1" role="toolbar" aria-label="Selected conversations">
              <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} className="mx-2 size-4 shrink-0 accent-sky-600" />
              <span className="mr-1 shrink-0 text-[13px] font-semibold tabular-nums">{selected.size} selected</span>
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
                <IconButton size="sm" label="Archive" icon={<Archive className="size-4" />} onClick={() => void bulk([...selected], "archive", undefined, "Archived")} />
                <IconButton size="sm" label="Trash" icon={<Trash2 className="size-4" />} onClick={() => void bulk([...selected], "trash", undefined, "Moved to trash")} />
                <IconButton size="sm" label="Mark read" icon={<MailOpen className="size-4" />} onClick={() => void bulk([...selected], "read")} />
                <IconButton size="sm" label="Mark unread" icon={<Mail className="size-4" />} onClick={() => void bulk([...selected], "unread")} />
                <IconButton size="sm" label="Star" icon={<Star className="size-4" />} onClick={() => void bulk([...selected], "star")} />
                <IconButton size="sm" label="Label" icon={<Tag className="size-4" />} onClick={() => setLabelIds([...selected])} />
                <IconButton size="sm" label="Snooze" icon={<AlarmClock className="size-4" />} onClick={() => setSnoozeIds([...selected])} />
                <Menu label="Move to category" trigger={(p) => <Button {...p} size="sm" variant="ghost">Move</Button>} items={CATEGORIES.map((c) => ({ label: CATEGORY_LABEL[c], onSelect: () => void bulk([...selected], "category", c, `Moved to ${CATEGORY_LABEL[c]}`) }))} />
                <IconButton size="sm" label="Spam" icon={<ShieldAlert className="size-4" />} onClick={() => void bulk([...selected], "spam", undefined, "Moved to spam")} />
              </div>
              <IconButton size="sm" label="Clear selection" icon={<X className="size-4" />} onClick={() => setSelected(new Set())} />
            </div>
          ) : (
            <div className="flex h-9 items-center gap-1">
              {/* On narrower screens the title opens the mailboxes and views. */}
              <button type="button" onClick={() => setRailOpen(true)} aria-label={`${viewLabel} — mailboxes and views`} className="min-w-0 flex-1 rounded-[10px] px-1 text-left @6xl/mail:pointer-events-none">
                <h1 className="flex items-center gap-1 text-[16px] leading-tight font-semibold tracking-[-0.01em]"><span className="truncate">{viewLabel}</span><ChevronDown className="size-4 shrink-0 text-muted @6xl/mail:hidden" /></h1>
                <p className="truncate text-[11.5px] text-muted">
                  {account === "all" ? (meta.accounts.length > 1 ? `All ${meta.accounts.length} mailboxes` : meta.accounts[0]?.address) : accountOf(meta.accounts, account)?.address}
                  {!!counts?.inbox && view === "inbox" && <> · {counts.inbox} unread</>}
                </p>
              </button>
              <IconButton label="Compose (c)" className="@6xl/mail:hidden" icon={<PenSquare className="size-4" />} onClick={() => setCompose(true)} />
              <Menu label="More" trigger={(p) => <IconButton {...p} label="Briefing and export" icon={<Sparkles className="size-4" />} />} items={[{ label: "Today's briefing (AI)", icon: <Sparkles />, onSelect: () => void getBriefing() }, { label: "Export this list (CSV)", icon: <ArrowDownToLine />, onSelect: () => window.open(`${base}/export?${params.toString()}`, "_blank") }]} />
              <IconButton label="Refresh" icon={<RefreshCw className={cx("size-4", list.isFetching && "animate-spin")} />} onClick={() => { void refresh(); for (const a of meta.accounts) void call(`accounts/${a.id}/sync`, "POST").catch(() => {}); }} />
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            {!selected.size && rows.length > 0 && <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} className="ml-2 size-4 shrink-0 accent-sky-600" />}
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input
                ref={search}
                aria-label="Search mail"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => setHints(true)}
                onBlur={() => setTimeout(() => setHints(false), 150)}
                onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setQ(""))}
                placeholder="Search mail"
                className="h-9 w-full rounded-[11px] border border-transparent bg-surface-2 pr-8 pl-9 text-[13.5px] transition-colors outline-none placeholder:text-subtle focus:border-sky-500/40 focus:bg-[var(--surface-solid)]"
                style={{ outline: "none" }}
              />
              <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5">
                {q && <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="grid size-6 place-items-center rounded-full text-muted hover:bg-fg/10"><X className="size-3.5" /></button>}
                <button type="button" aria-label="Advanced search" aria-expanded={advanced} onClick={() => { setHints(false); setAdvanced(!advanced); }} className={cx("grid size-6 place-items-center rounded-full text-muted hover:bg-fg/10 hover:text-fg", advanced && "bg-fg/10 text-fg")}><SlidersHorizontal className="size-3.5" /></button>
              </div>
              {advanced && <AdvancedSearch q={q} onClose={() => setAdvanced(false)} onSearch={(v) => { setQ(v); setAdvanced(false); }} />}
              {hints && !q && !advanced && (
                <div className="absolute top-full right-0 left-0 z-20 mt-1.5 grid gap-0.5 rounded-[14px] border border-border bg-[var(--surface-solid)] p-2 shadow-xl">
                  <p className="px-2 pb-1 text-[11px] font-semibold tracking-[0.1em] text-subtle uppercase">Search operators</p>
                  {OPERATORS.map(([op, d]) => (
                    <button key={op} type="button" onMouseDown={(e) => { e.preventDefault(); setQ(`${op}`); search.current?.focus(); }} className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1 text-left text-[12.5px] hover:bg-surface-2"><code className="text-sky-700 dark:text-sky-400">{op}</code><span className="truncate text-muted">{d}</span></button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {view === "inbox" && !label && !query ? (
            <ScrollTabs>
              {(["all", ...CATEGORIES] as const).map((c) => {
                const n = c === "all" ? undefined : counts?.categories[c];
                return (
                  <button key={c} type="button" role="tab" aria-selected={category === c} onClick={(e) => { e.currentTarget.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); choose({ category: c }); }} className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors", category === c ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                    {c === "all" ? "Everything" : CATEGORY_LABEL[c]}
                    {!!n && <span className={cx("min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] leading-[16px] tabular-nums", category === c ? "bg-bg/20" : "bg-sky-500/15 text-sky-700 dark:text-sky-300")}>{n}</span>}
                  </button>
                );
              })}
            </ScrollTabs>
          ) : <div className="h-2.5" />}
        </div>
        {briefing && (
          <div className="relative m-3 mb-0 rounded-[14px] border border-accent/30 bg-accent/5 p-3 text-[13px]">
            <button type="button" aria-label="Close briefing" onClick={() => setBriefing(null)} className="absolute top-2 right-2 grid size-6 place-items-center rounded-full text-muted hover:bg-fg/10"><X className="size-3.5" /></button>
            <p className="flex items-center gap-1.5 font-semibold"><Sparkles className="size-3.5 text-accent" /> Today&apos;s briefing</p>
            {briefing.busy ? <p className="mt-1 flex items-center gap-2 text-muted"><Loader2 className="size-3.5 animate-spin" /> Reading today&apos;s mail…</p> : briefing.error ? <p className="mt-1 text-muted">{briefing.error}</p> : <p className="mt-1 whitespace-pre-line">{briefing.text}</p>}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label={viewLabel}>
          {list.isError ? (
            <div className="p-4"><ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} /></div>
          ) : !list.data ? (
            <div className="grid gap-2 p-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[68px] rounded-[12px]" />)}</div>
          ) : rows.length === 0 ? (
            <Empty view={view} query={query} syncing={meta.accounts.some((a) => a.status === "connecting")} />
          ) : (
            rows.map((t, i) => (
              <Row
                key={t.id}
                t={t}
                meta={meta}
                unified={account === "all" && meta.accounts.length > 1}
                view={view}
                active={open === t.id}
                cursor={cursor === i}
                checked={selected.has(t.id)}
                onCheck={(shift) => {
                  setSelected((s) => {
                    const n = new Set(s);
                    if (shift && anchor !== null) {
                      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
                      for (let j = a; j <= b; j++) n.add(rows[j]!.id);
                    } else if (n.has(t.id)) n.delete(t.id);
                    else n.add(t.id);
                    return n;
                  });
                  setAnchor(i);
                }}
                onOpen={() => openRow(i)}
                onQuick={(a) => void bulk([t.id], a, undefined, a === "archive" ? "Archived" : undefined)}
                onSnooze={() => setSnoozeIds([t.id])}
              />
            ))
          )}
          <div ref={sentinel} className="h-6" />
          {list.isFetchingNextPage && <p className="pb-4 text-center text-[12px] text-muted">Loading more…</p>}
        </div>
      </section>

      {/* Conversation */}
      <section aria-label="Conversation" className={cx("min-h-0 min-w-0 flex-col bg-bg", open ? "flex" : "hidden @3xl/mail:flex")}>
        {open && full ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <span className="mx-auto grid size-12 place-items-center rounded-[16px] bg-surface-2 text-muted"><Maximize2 className="size-5" /></span>
              <p className="mt-3 text-[14px] font-semibold">Reading in full screen</p>
              <Button size="sm" className="mt-3" onClick={closeFull}>Back to the inbox</Button>
            </div>
          </div>
        ) : open ? (
          <ThreadView key={open} id={open} meta={meta} onBack={() => setOpen(null)} onClosed={() => setOpen(null)} replyRequest={replyReq} noteRequest={noteReq} onFullscreen={openFull} />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="max-w-xs">
              <span className="mx-auto grid size-14 place-items-center rounded-[18px] bg-sky-500/10 text-sky-600 dark:text-sky-400"><Inbox className="size-6" /></span>
              <p className="mt-4 text-[15px] font-semibold">Pick a conversation</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{keyboard ? <>Use <Keys k="j" /> <Keys k="k" /> to move, <Keys k="enter" /> to open and <Keys k="?" /> for every shortcut.</> : "Tap a conversation to open it."}</p>
            </div>
          </div>
        )}
      </section>

      {open && full && (
        <FullscreenReader swapKey={open} index={Math.max(0, at)} total={rows.length} closing={full === "closing"} direction={dir} zoom={zoom} setZoom={setZoom} onPrev={at > 0 ? () => step(-1) : null} onNext={at >= 0 && at < rows.length - 1 ? () => step(1) : null} onExit={closeFull}>
          <ThreadView key={open} id={open} meta={meta} onBack={closeFull} onClosed={advance} replyRequest={replyReq} noteRequest={noteReq} fullscreen zoom={zoom} />
        </FullscreenReader>
      )}
    </div>

      {/* Phones: compose is always one tap away. */}
      {!open && (
        <button type="button" onClick={() => setCompose(true)} className="absolute right-4 bottom-5 z-20 inline-flex h-12 items-center gap-2 rounded-full bg-fg pr-5 pl-4 text-[14px] font-semibold text-bg shadow-[0_12px_30px_-10px_rgb(0_0_0/0.5)] transition-transform active:scale-95 @3xl/mail:hidden">
          <PenSquare className="size-[18px]" /> Compose
        </button>
      )}

      {compose && <Composer mode="new" accounts={meta.accounts} thread={null} message={null} defaultAccount={account !== "all" ? account : undefined} draftKey="new" onClose={() => setCompose(false)} />}
      {help && <Dialog open onClose={() => setHelp(false)} size="lg" title="Keyboard shortcuts"><ShortcutList /></Dialog>}
      {snoozeIds && <SnoozeDialog onClose={() => setSnoozeIds(null)} onPick={(iso) => { void bulk(snoozeIds, "snooze", iso, "Snoozed"); setSnoozeIds(null); }} />}
      {labelIds && <LabelDialog labels={meta.labels} onClose={() => setLabelIds(null)} onPick={(l) => { void bulk(labelIds, "label", l, `Labelled “${l}”`); setLabelIds(null); }} />}
    </div>
  );
}

/** Search by fields: builds the same operators you can type (from:, has:attachment, after: …). */
function AdvancedSearch({ q, onClose, onSearch }: { q: string; onClose: () => void; onSearch: (q: string) => void }) {
  const p = parseSearch(q);
  const [f, setF] = useState({ from: p.from ?? "", to: p.to ?? "", subject: p.subject ?? "", words: p.text, category: p.category ?? "", after: p.after ?? "", before: p.before ?? "", attachment: !!p.hasAttachment, unread: !!p.unread, starred: !!p.starred });
  const quote = (v: string) => (/\s/.test(v) ? `"${v.replace(/"/g, "")}"` : v);
  const build = () =>
    [f.from && `from:${quote(f.from.trim())}`, f.to && `to:${quote(f.to.trim())}`, f.subject && `subject:${quote(f.subject.trim())}`, f.category && `category:${f.category}`, f.after && `after:${f.after}`, f.before && `before:${f.before}`, f.attachment && "has:attachment", f.unread && "is:unread", f.starred && "is:starred", f.words.trim()]
      .filter(Boolean)
      .join(" ");
  const field = "h-8 w-full rounded-[9px] border border-border bg-[var(--surface-solid)] px-2.5 text-[13px] outline-none focus:border-sky-500/50";
  const row = (label: string, el: ReactNode) => <label className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2 text-[12.5px] text-muted">{label}{el}</label>;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSearch(build()); }}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}
      className="absolute top-full right-0 left-0 z-30 mt-1.5 grid gap-2 rounded-[16px] border border-border bg-[var(--surface-solid)] p-3.5 shadow-2xl"
    >
      <p className="mb-0.5 text-[12px] font-semibold">Advanced search</p>
      {row("From", <input autoFocus className={field} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="Name or address" style={{ outline: "none" }} />)}
      {row("To", <input className={field} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={{ outline: "none" }} />)}
      {row("Subject", <input className={field} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} style={{ outline: "none" }} />)}
      {row("Has words", <input className={field} value={f.words} onChange={(e) => setF({ ...f, words: e.target.value })} style={{ outline: "none" }} />)}
      {row("Category", <select className={field} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Any</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>)}
      {row("After", <input type="date" aria-label="After" className={field} value={f.after} onChange={(e) => setF({ ...f, after: e.target.value })} />)}
      {row("Before", <input type="date" aria-label="Before" className={field} value={f.before} min={f.after || undefined} onChange={(e) => setF({ ...f, before: e.target.value })} />)}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 pl-[92px] text-[12.5px]">
        {([["attachment", "Has attachments"], ["unread", "Unread"], ["starred", "Starred"]] as const).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} className="size-3.5 accent-sky-600" />{l}</label>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <code className="min-w-0 truncate text-[11.5px] text-muted">{build() || "Fill in any field"}</code>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => { onSearch(""); }}>Clear</Button>
          <Button size="sm" variant="primary" type="submit" disabled={!build()}>Search</Button>
        </div>
      </div>
    </form>
  );
}

/** Category tabs in one row that scrolls, with arrows when some are out of view. */
function ScrollTabs({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      ro?.disconnect();
    };
  }, []);
  const nudge = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  const arrow = "absolute top-0 z-10 grid h-7 w-9 place-items-center text-muted hover:text-fg";
  return (
    <div className="relative -mx-3 mt-2 pb-2.5">
      <div ref={ref} role="tablist" aria-label="Categories" className="flex gap-1 overflow-x-auto scroll-smooth px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
      {edge.left && <button type="button" tabIndex={-1} aria-hidden onClick={() => nudge(-1)} className={cx(arrow, "left-0 justify-items-start bg-[linear-gradient(to_right,var(--bg)_55%,transparent)] pl-2")}><ChevronLeft className="size-4" /></button>}
      {edge.right && <button type="button" tabIndex={-1} aria-hidden onClick={() => nudge(1)} className={cx(arrow, "right-0 justify-items-end bg-[linear-gradient(to_left,var(--bg)_55%,transparent)] pr-2")}><ChevronRight className="size-4" /></button>}
    </div>
  );
}

function RailItem({ active, onClick, icon, label, sub, count, alert, status, muted }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; sub?: string; count?: number; alert?: number; status?: string; muted?: boolean }) {
  return (
    <button type="button" aria-current={active ? "page" : undefined} onClick={onClick} className={cx("flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] transition-colors [&>span:first-child>svg]:size-4", active ? "bg-fg/[0.07] font-semibold text-fg" : muted ? "text-muted hover:bg-surface-2 hover:text-fg" : "text-fg/85 hover:bg-surface-2")}>
      <span className="grid w-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}{sub && <span className="ml-1 text-[11px] font-normal text-subtle">{sub}</span>}</span>
      {status === "error" && <span title="Needs attention" className="size-2 rounded-full bg-danger" />}
      {status === "connecting" && <Loader2 aria-label="Syncing" className="size-3 animate-spin text-muted" />}
      {!!alert && <span title={`${alert} past the reply target`} className="rounded-full bg-danger px-1.5 text-[10.5px] leading-4 font-semibold text-white tabular-nums">{alert}</span>}
      {!!count && count !== alert && <span className="text-[11.5px] tabular-nums text-muted">{count > 999 ? "999+" : count}</span>}
    </button>
  );
}

function Row({ t, meta, unified, view, active, cursor, checked, onCheck, onOpen, onQuick, onSnooze }: { t: ThreadRow; meta: MetaOut; unified: boolean; view: View; active: boolean; cursor: boolean; checked: boolean; onCheck: (shift: boolean) => void; onOpen: () => void; onQuick: (a: "archive" | "read" | "unread" | "star" | "unstar") => void; onSnooze: () => void }) {
  const me = new Set(meta.accounts.map((a) => a.address.toLowerCase()));
  const others = t.participants.filter((p) => !me.has(p.address.toLowerCase()));
  const shown = others.length ? others : t.participants;
  const names = shown.slice(0, 3).map((p) => (shown.length > 1 ? personName(p).split(" ")[0] : personName(p))).join(", ") + (shown.length > 3 ? ` +${shown.length - 3}` : "");
  const account = accountOf(meta.accounts, t.accountId);
  const unread = t.unread > 0;
  // Waiting on us: how long, and whether it's past the mailbox's reply target.
  const owed = t.awaitingSince && !t.muted && REPLY_CATEGORIES.includes(t.category) ? slaState(t.awaitingSince, account?.settings.slaHours ?? null) : null;
  const showWait = !!owed && (view === "needsreply" || owed.overdue);
  const chips = !!t.meetingAt || showWait || t.muted || t.labels.length > 0 || t.snoozeUntil || t.followUpAt || (t.lastDirection === "out" && t.status === "inbox") || t.assigneeId || t.category === "screener";
  return (
    <div
      role="listitem"
      data-testid="mail-thread-row"
      aria-current={active ? "true" : undefined}
      className={cx("group relative flex cursor-pointer gap-3 border-b border-border/60 py-3 pr-3 pl-5 transition-colors", active ? "bg-sky-500/[0.09]" : checked ? "bg-sky-500/[0.05]" : cursor ? "bg-fg/[0.035]" : "hover:bg-fg/[0.03]")}
      onClick={onOpen}
    >
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-sky-500" />}
      {unread && !active && <span aria-label="Unread" className="absolute top-[22px] left-[6px] size-[7px] rounded-full bg-sky-500" />}
      <div className="relative shrink-0 self-start" onClick={(e) => e.stopPropagation()}>
        {/* In the unified inbox, a ring in the mailbox's colour says which mailbox it's in. */}
        <span title={unified ? account?.name : undefined} className={cx("block rounded-full transition-opacity", checked ? "opacity-0" : "group-hover:opacity-0")} style={unified && account ? { boxShadow: `0 0 0 2px var(--bg), 0 0 0 3.5px ${account.color}` } : undefined}><Avatar p={shown[0] ?? { name: "?", address: "?" }} size={36} /></span>
        <input type="checkbox" aria-label={`Select ${t.subject}`} checked={checked} onChange={() => {}} onClick={(e) => onCheck(e.shiftKey)} className={cx("absolute inset-0 m-auto size-4 accent-sky-600 transition-opacity", checked ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cx("min-w-0 truncate text-[13.5px]", unread ? "font-semibold text-fg" : "font-medium text-fg/75")}>{t.lastDirection === "out" && !others.length ? `To: ${names}` : names}</span>
          {t.messageCount > 1 && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10.5px] leading-4 font-medium text-muted tabular-nums">{t.messageCount}</span>}
          {t.priority === "high" && <span title="Important" className="size-1.5 shrink-0 rounded-full bg-danger" />}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[11.5px] text-muted tabular-nums transition-opacity group-hover:opacity-0">
            {t.pinned && <Pin className="size-3" />}
            {t.hasAttachments && <Paperclip className="size-3" />}
            {t.warnings.length > 0 && <ShieldAlert className="size-3 text-danger" />}
            <span className={cx(unread && "font-semibold text-sky-700 dark:text-sky-400")}>{shortTime(t.lastMessageAt)}</span>
          </span>
        </div>
        <p className={cx("mt-0.5 truncate text-[13px]", unread ? "font-medium text-fg" : "text-fg/70")}>{t.subject || "(no subject)"}</p>
        <p className="mt-0.5 line-clamp-1 text-[12.5px] leading-snug text-muted">{t.snippet}</p>
        {chips && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {t.meetingAt && <Badge tone={t.meetingEventId ? "success" : "accent"}><Video className="size-3" /> {new Date(t.meetingAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{t.meetingEventId && " ✓"}</Badge>}
            {showWait && owed && <Badge tone={owed.overdue ? "danger" : "warning"}><Clock className="size-3" /> {owed.overdue ? "Overdue · " : "Waiting "}{fmtMinutes(owed.waitingMs / 60_000)}</Badge>}
            {t.muted && <Badge><BellOff className="size-3" /> Muted</Badge>}
            {t.category === "screener" && <Badge tone="warning">New sender</Badge>}
            {t.snoozeUntil && <Badge tone="warning"><AlarmClock className="size-3" /> {shortTime(t.snoozeUntil)}</Badge>}
            {t.followUpAt && <Badge tone="warning"><BellRing className="size-3" /> {shortTime(t.followUpAt)}</Badge>}
            {t.lastDirection === "out" && !t.followUpAt && <Badge>Waiting</Badge>}
            {t.assigneeId && <Badge><AtSign className="size-3" />{meta.members.find((m) => m.id === t.assigneeId)?.name.split(" ")[0] ?? "Assigned"}</Badge>}
            {t.labels.slice(0, 3).map((l) => <Badge key={l} tone="accent">{l}</Badge>)}
          </div>
        )}
      </div>
      {/* Hover actions sit where the time was. */}
      <div className="absolute top-2 right-2 hidden items-center gap-0.5 rounded-full bg-[var(--surface-solid)] p-0.5 shadow-[0_4px_14px_-6px_rgb(0_0_0/0.3)] ring-1 ring-border group-hover:flex" onClick={(e) => e.stopPropagation()}>
        <IconButton size="sm" label="Archive" icon={<Archive className="size-3.5" />} onClick={() => onQuick("archive")} />
        <IconButton size="sm" label={unread ? "Mark read" : "Mark unread"} icon={unread ? <MailOpen className="size-3.5" /> : <Mail className="size-3.5" />} onClick={() => onQuick(unread ? "read" : "unread")} />
        <IconButton size="sm" label="Snooze" icon={<AlarmClock className="size-3.5" />} onClick={onSnooze} />
        <IconButton size="sm" label={t.starred ? "Unstar" : "Star"} icon={<Star className={cx("size-3.5", t.starred && "fill-amber-400 text-amber-400")} />} onClick={() => onQuick(t.starred ? "unstar" : "star")} />
      </div>
      {t.starred && <Star aria-label="Starred" className="absolute right-3 bottom-3 size-3.5 fill-amber-400 text-amber-400" />}
    </div>
  );
}

function Empty({ view, query, syncing }: { view: View; query: string; syncing: boolean }) {
  if (view === "meetings" && !query)
    return <EmptyState className="py-16" icon={<Video className="size-6" />} title="No meetings found yet" description="Emails with a calendar invite or a meeting link (Meet, Zoom, Teams, Zoho…) show up here. Mail from before Calendar was on is checked automatically — or check now." action={<FindMeetingsButton />} />;
  if (query) return <EmptyState className="py-16" icon={<Search className="size-6" />} title="Nothing matches" description="Try fewer words, or an operator like from: or has:attachment." />;
  if (syncing) return <EmptyState className="py-16" icon={<Loader2 className="size-6 animate-spin" />} title="Bringing in your mail…" description="The first sync takes a minute or two. Newest mail arrives first." />;
  const copy: Partial<Record<View, [string, string]>> = {
    inbox: ["Inbox zero 🎉", "Nothing waiting for you. Enjoy it."],
    needsreply: ["All caught up", "Nobody is waiting on a reply from you."],
    meetings: ["No meetings in your mail", "Emails with a calendar invite or a meeting link (Meet, Zoom, Teams…) show up here, ready to add to your calendar."],
    muted: ["Nothing muted", "Mute a noisy conversation from its menu — new replies then skip your inbox."],
    starred: ["No starred mail", "Press s on any conversation to star it."],
    snoozed: ["Nothing snoozed", "Snooze mail (b) to have it come back when you need it."],
    waiting: ["Nobody owes you a reply", "Conversations where you wrote last show here."],
    followups: ["No follow-ups due", "Set “Remind me if no reply” when you send."],
    scheduled: ["Nothing scheduled", "Use the arrow next to Send to send later."],
    trash: ["Trash is empty", ""],
    spam: ["No spam", "Mail you mark as spam lands here."],
  };
  const [title, desc] = copy[view] ?? ["Nothing here", ""];
  return <EmptyState className="py-16" icon={<Inbox className="size-6" />} title={title} description={desc} />;
}

function SnoozeDialog({ onClose, onPick }: { onClose: () => void; onPick: (iso: string) => void }) {
  const [at, setAt] = useState("");
  return (
    <Dialog open onClose={onClose} size="sm" title="Snooze until" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!at || new Date(at) <= new Date()} onClick={() => onPick(new Date(at).toISOString())}>Snooze</Button></>}>
      <div className="grid gap-1.5">
        {presets().map((p) => (
          <button key={p.label} type="button" onClick={() => onPick(p.at.toISOString())} className="flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13.5px] hover:bg-surface-2">
            <span>{p.label}</span>
            <span className="text-[12px] text-muted">{p.at.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
          </button>
        ))}
        <input type="datetime-local" aria-label="Pick a date and time" value={at} onChange={(e) => setAt(e.target.value)} className="mt-2 h-9 rounded-[10px] border border-border bg-surface px-3 text-[13.5px]" />
      </div>
    </Dialog>
  );
}

function LabelDialog({ labels, onClose, onPick }: { labels: string[]; onClose: () => void; onPick: (l: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Dialog open onClose={onClose} size="sm" title="Add a label">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onPick(text.trim()); }}>
        <input autoFocus aria-label="Label" value={text} onChange={(e) => setText(e.target.value)} placeholder="New or existing label" className="h-9 rounded-[10px] border border-border bg-surface px-3 text-[13.5px]" />
        <div className="flex flex-wrap gap-1.5">
          {labels.filter((l) => l.toLowerCase().includes(text.toLowerCase())).map((l) => <button key={l} type="button" onClick={() => onPick(l)} className="h-7 rounded-full px-3 text-[12.5px] ring-1 ring-border hover:bg-surface-2">{l}</button>)}
        </div>
        <Button type="submit" variant="primary" disabled={!text.trim()}>Add label</Button>
      </form>
    </Dialog>
  );
}

