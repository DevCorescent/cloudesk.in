"use client";

// What someone outside the workspace sees from an invite link: who invited
// them and to what, a form asking only for their name, a waiting room until
// an admin lets them in, and then the conversation itself — live messages,
// threads, reactions, polls, files — with nothing else of the workspace.
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, Bell, BellOff, Check, Copy, Hash, Link2, Loader2, LogOut, MessageSquareReply, MoreHorizontal, Paperclip, SendHorizontal, ShieldCheck, Smile, Users, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/brand";
import { ConfirmDialog, Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Textarea, cx } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import type { GuestStateOut, MessageOut, PageOut, PersonOut } from "@/lib/chat/api";
import { MAX_BODY, MAX_FILE } from "@/lib/chat/model";
import { plain, preview } from "@/lib/chat/text";
import { copyText } from "@/lib/client/copy";
import "./chat.css";
import { EmojiPicker } from "./composer";
import { Message, type Ops } from "./message";
import { Avatar, channelTitle, dayLabel, fileSize, presenceOf } from "./shared";
import { useShortcuts } from "@/components/ui/shortcut";

type Invite = GuestStateOut["invite"];
const ROOT = "/api/v1/guest/chat";
const GROUP_MS = 5 * 60_000;
const keyStore = (ch: string) => `cc-guest-key:${ch}`;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

export function GuestApp({ code, invite }: { code: string; invite: Invite | null }) {
  if (!invite) return <Shell><Card icon={<Link2 />} title="This invite link doesn't work" sub="It may have been mistyped, or the conversation was deleted. Ask whoever sent it for a new one." /></Shell>;
  return <Guest code={code} invite={invite} />;
}

function Guest({ code, invite }: { code: string; invite: Invite }) {
  const base = `${ROOT}/c/${invite.channelId}`;
  const [resumed, setResumed] = useState(false);
  // A personal link (…#k=secret) signs this browser in as the same guest.
  useEffect(() => {
    const k = /(?:^|[#&])k=([\w-]{20,100})/.exec(window.location.hash)?.[1];
    if (!k) {
      void Promise.resolve().then(() => setResumed(true));
      return;
    }
    history.replaceState(null, "", window.location.pathname);
    api(`${base}/resume`, { method: "POST", body: { token: k } })
      .then(() => store.set(keyStore(invite.channelId), k))
      .catch(() => {})
      .finally(() => setResumed(true));
  }, [base, invite.channelId]);
  const state = useQuery({
    queryKey: ["guest-chat", invite.channelId],
    queryFn: () => api<GuestStateOut>(base),
    enabled: resumed,
    refetchInterval: (q) => (q.state.data?.guest?.status === "pending" ? 4000 : 60_000),
    retry: 1,
  });
  const s = state.data;
  if (!resumed || (state.isLoading && !s)) return <Shell><div className="grid place-items-center py-24"><Loader2 className="size-6 animate-spin text-subtle" /></div></Shell>;
  if (state.isError && !s) return <Shell><Card icon={<Link2 />} title="Couldn't open this conversation" sub={errorMessage(state.error)} action={<Button onClick={() => void state.refetch()}>Try again</Button>} /></Shell>;
  const g = s?.guest;
  const refresh = () => void state.refetch();
  if (g?.status === "approved" && s?.channel) return <GuestChat code={code} state={s} refresh={refresh} />;
  return (
    <Shell>
      <Hero invite={invite} />
      {g?.status === "pending" ? (
        <Waiting id={g.userId} name={g.name} base={base} invite={invite} onDone={refresh} />
      ) : g?.status === "rejected" ? (
        <Card icon={<X />} title="You weren't let in" sub={g.reason ? `The admin said: “${g.reason}”` : "An admin of the conversation declined your request."} action={<LeaveButton base={base} label="Use a different name" onDone={refresh} />} />
      ) : g?.status === "removed" ? (
        <Card icon={<X />} title="You were removed from this conversation" sub="Ask the person who invited you if you think that's a mistake." />
      ) : invite.problem || s?.invite.problem ? (
        <Card icon={<Link2 />} title="This invite can't be used" sub={s?.invite.problem ?? invite.problem ?? ""} />
      ) : (
        <JoinForm code={code} invite={invite} left={g?.status === "left"} onJoined={(token) => { store.set(keyStore(invite.channelId), token); refresh(); }} />
      )}
    </Shell>
  );
}

// ── Before they're in ───────────────────────────────────────────────────────

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto grid max-w-[480px] gap-6 px-4 py-10 sm:py-16">
        {children}
        <footer className="mt-6 flex items-center justify-center gap-1.5 text-[12px] text-muted">Chat by <Wordmark className="text-[14px]" /></footer>
      </main>
    </div>
  );
}

function ConvBadge({ invite, size = 56 }: { invite: Pick<Invite, "kind" | "emoji" | "color">; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[18px] text-white shadow-sm" style={{ width: size, height: size, background: invite.kind === "channel" ? invite.color : "linear-gradient(135deg,#8b5cf6,#0ea5e9)", fontSize: size * 0.42 }}>
      {invite.emoji || (invite.kind === "channel" ? <Hash style={{ width: size * 0.4, height: size * 0.4 }} /> : <Users style={{ width: size * 0.4, height: size * 0.4 }} />)}
    </span>
  );
}

function Hero({ invite }: { invite: Invite }) {
  return (
    <div className="grid justify-items-center gap-3 text-center">
      <ConvBadge invite={invite} />
      <p className="text-[13px] text-muted"><b className="font-semibold text-fg">{invite.inviter}</b> invited you to chat in</p>
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{invite.where}</h1>
      <p className="text-[13.5px] text-muted">{invite.workspace}{invite.topic ? ` · ${invite.topic}` : ""}</p>
    </div>
  );
}

function Card({ icon, title, sub, action }: { icon: ReactNode; title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-[22px] border border-border bg-[var(--surface-solid)] p-6 text-center shadow-sm">
      <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-muted [&>svg]:size-5">{icon}</span>
      <p className="text-[16px] font-semibold">{title}</p>
      <p className="text-[13.5px] text-muted">{sub}</p>
      {action}
    </div>
  );
}

function JoinForm({ code, invite, left, onJoined }: { code: string; invite: Invite; left: boolean; onJoined: (token: string) => void }) {
  const [v, setV] = useState({ name: "", contact: "", note: "" });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [top, setTop] = useState<string | null>(null);
  // The name they used last time, once the page is in the browser.
  useEffect(() => {
    const n = store.get("cc-guest-name");
    if (n) void Promise.resolve().then(() => setV((x) => (x.name ? x : { ...x, name: n })));
  }, []);
  return (
    <form
      className="grid gap-4 rounded-[22px] border border-border bg-[var(--surface-solid)] p-5 shadow-sm sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr({});
        setTop(null);
        try {
          const r = await api<{ token: string }>(`${ROOT}/invite/${code}/join`, { method: "POST", body: v });
          store.set("cc-guest-name", v.name.trim());
          onJoined(r.token);
        } catch (e) {
          const f = e instanceof ApiClientError ? e.fieldErrors() : {};
          setErr(Object.fromEntries(Object.entries(f).map(([k, x]) => [k, x[0] ?? ""])));
          if (!Object.keys(f).length) setTop(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {left && <p className="rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] text-muted">You left this conversation. You can ask to join again.</p>}
      <Field label="Your name" error={err.name} hint="This is how everyone in the conversation will see you.">{(p) => <Input {...p} autoFocus autoComplete="name" value={v.name} maxLength={60} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Priya Sharma" required />}</Field>
      {more ? (
        <>
          <Field label="Email or phone (optional)" error={err.contact} hint="Only the conversation's admins see it.">{(p) => <Input {...p} autoComplete="email" value={v.contact} maxLength={120} onChange={(e) => setV({ ...v, contact: e.target.value })} placeholder="you@example.com or +91…" />}</Field>
          {invite.approval && <Field label="A note for the admin (optional)" error={err.note}>{(p) => <Textarea {...p} rows={2} value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Hi, I'm from the design agency…" />}</Field>}
        </>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="-mt-1 w-fit text-[12.5px] font-medium text-sky-700 hover:underline dark:text-sky-400">Add contact details or a note</button>
      )}
      {top && <p role="alert" className="rounded-[12px] bg-red-500/10 px-3 py-2 text-[13px] text-red-700 dark:text-red-300">{top}</p>}
      <Button type="submit" variant="primary" size="md" loading={busy} disabled={v.name.trim().length < 2}>{invite.approval ? "Ask to join" : "Join the conversation"}</Button>
      <p className="flex items-start gap-2 text-[12px] text-muted"><ShieldCheck className="mt-px size-3.5 shrink-0" />No account or password. You&apos;ll see only this conversation{invite.approval ? ", once an admin lets you in" : ""}. Members of {invite.workspace} see your name and what you write.</p>
    </form>
  );
}

function Waiting({ id, name, base, invite, onDone }: { id: string; name: string; base: string; invite: Invite; onDone: () => void }) {
  // Tell them when they're let in, even if the tab is in the background.
  useEffect(() => {
    const t = document.title;
    document.title = `Waiting… · ${invite.where}`;
    return () => void (document.title = t);
  }, [invite.where]);
  return (
    <div className="grid justify-items-center gap-3 rounded-[22px] border border-border bg-[var(--surface-solid)] p-6 text-center shadow-sm">
      <span className="relative grid size-14 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-teal-500/20" />
        <Avatar id={id} name={name} size={48} />
      </span>
      <p className="text-[16px] font-semibold">Hi {name.split(" ")[0]} — you&apos;re on the list</p>
      <p className="text-[13.5px] text-muted">An admin of {invite.where} has been told you&apos;re waiting. This page opens the conversation by itself as soon as you&apos;re let in — keep it open, or come back to this link later on this device.</p>
      <p className="inline-flex items-center gap-1.5 text-[12px] text-subtle"><Loader2 className="size-3 animate-spin" />Checking every few seconds</p>
      <LeaveButton base={base} label="Cancel my request" onDone={onDone} />
    </div>
  );
}

function LeaveButton({ base, label, onDone }: { base: string; label: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="ghost" loading={busy} onClick={async () => { setBusy(true); await api(base, { method: "DELETE" }).catch(() => {}); setBusy(false); onDone(); }}>{label}</Button>
  );
}

// ── In the conversation ─────────────────────────────────────────────────────

function merge(list: MessageOut[], incoming: MessageOut[]) {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

/** A page of messages (the conversation, or one thread) kept fresh by id. */
function useList(base: string, thread: string | null) {
  const [list, setList] = useState<MessageOut[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = thread ? `thread=${thread}` : "";
  // Loading until the answer for this request is in.
  const [loaded, setLoaded] = useState("");
  const loading = loaded !== `${base}?${q}`;
  useEffect(() => {
    let live = true;
    api<PageOut>(`${base}/messages?${q}`)
      .then((r) => live && (setList(r.messages), setHasMore(r.hasMore), setError(null)))
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoaded(`${base}?${q}`));
    return () => {
      live = false;
    };
  }, [base, q]);
  const refresh = useCallback(async (id: string) => {
    try {
      const r = await api<{ message: MessageOut }>(`${base}/messages/${id}`);
      const m = r.message;
      // The conversation shows top-level messages (and replies also sent to it); a thread shows its root and replies.
      const fits = thread ? m.id === thread || m.parentId === thread : !m.parentId || !!(m.data as { alsoToChannel?: boolean }).alsoToChannel;
      if (fits) setList((l) => merge(l, [m]));
    } catch {
      setList((l) => l.filter((m) => m.id !== id));
    }
  }, [base, thread]);
  const newer = useCallback(async () => {
    const last = list[list.length - 1]?.seq;
    if (!last) return;
    const r = await api<PageOut>(`${base}/messages?${q}&after=${last}`).catch(() => null);
    if (r?.messages.length) setList((l) => merge(l, r.messages));
  }, [base, q, list]);
  const older = useCallback(async () => {
    const first = list[0]?.seq;
    if (!first || !hasMore) return;
    const r = await api<PageOut>(`${base}/messages?${q}&before=${first}`).catch(() => null);
    if (r) {
      setList((l) => merge(l, r.messages));
      setHasMore(r.hasMore);
    }
  }, [base, q, list, hasMore]);
  return { list, setList, hasMore, loading, error, refresh, newer, older };
}

type Live = { connected: boolean; typing: { u: string; thread: string | null; at: number }[] };

function GuestChat({ code, state, refresh: refreshState }: { code: string; state: GuestStateOut; refresh: () => void }) {
  const channel = state.channel!;
  const me = state.guest!;
  const base = `${ROOT}/c/${channel.id}`;
  const toast = useToast();
  const people = useMemo(() => new Map<string, PersonOut>(state.people.map((p) => [p.id, p])), [state.people]);
  const title = channel.kind === "channel" ? `#${channel.name}` : channelTitle(channel, people);
  const msgs = useList(base, null);
  const [thread, setThread] = useState<string | null>(null);
  const [editing, setEditing] = useState<MessageOut | null>(null);
  const [deleting, setDeleting] = useState<MessageOut | null>(null);
  const [rejecting, setRejecting] = useState<MessageOut | null>(null);
  const [emojiFor, setEmojiFor] = useState<{ m: MessageOut; r: DOMRect } | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [live, setLive] = useState<Live>({ connected: false, typing: [] });
  const [fresh, setFresh] = useState(0);
  const [notifyOn, setNotifyOn] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const unseen = useRef(0);
  const threadRefresh = useRef<((id: string) => void) | null>(null);

  const act = useCallback(async (path: string, method: string, body?: unknown, ok?: string) => {
    try {
      const r = await api(`${base}/${path}`, { method, body });
      if (ok) toast({ tone: "success", title: ok });
      return r;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return null;
    }
  }, [base, toast]);

  // Live: messages, typing and changes to the conversation (or to the guest).
  const { refresh, newer } = msgs;
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`${base}/stream`);
    let stateTimer: ReturnType<typeof setTimeout> | null = null;
    const later = () => {
      if (stateTimer) return;
      stateTimer = setTimeout(() => {
        stateTimer = null;
        refreshState();
      }, 400);
    };
    es.addEventListener("hello", () => setLive((l) => ({ ...l, connected: true })));
    es.onerror = () => setLive((l) => ({ ...l, connected: false }));
    es.addEventListener("m", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { id?: string; thread?: string | null; u?: string };
      if (!d.id) return;
      setLive((l) => (l.typing.length ? { ...l, typing: [] } : l));
      if (d.thread) {
        void refresh(d.thread);
        threadRefresh.current?.(d.id);
      } else {
        void refresh(d.id);
        if (!atBottom.current) setFresh((n) => n + 1);
      }
      if (document.visibilityState !== "visible") {
        unseen.current += 1;
        document.title = `(${unseen.current}) ${title}`;
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          void api<{ message: MessageOut }>(`${base}/messages/${d.id}`).then((r) => {
            if (r.message.authorId === me.userId || r.message.kind === "system") return;
            new Notification(`${people.get(r.message.authorId ?? "")?.name ?? "New message"} · ${title}`, { body: preview(r.message.body, 140) || "Sent something", tag: channel.id });
          }).catch(() => {});
        }
      }
    });
    es.addEventListener("t", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { u?: string; thread?: string | null };
      if (d.u) setLive((l) => ({ ...l, typing: [...l.typing.filter((x) => x.u !== d.u), { u: d.u!, thread: d.thread ?? null, at: Date.now() }] }));
    });
    es.addEventListener("c", later);
    es.addEventListener("p", later);
    const fade = setInterval(() => setLive((l) => (l.typing.some((x) => Date.now() - x.at > 6000) ? { ...l, typing: l.typing.filter((x) => Date.now() - x.at < 6000) } : l)), 2000);
    return () => {
      es.close();
      clearInterval(fade);
      if (stateTimer) clearTimeout(stateTimer);
    };
  }, [base, refresh, refreshState, title, people, me.userId, channel.id]);

  // Catch up after the connection drops; say "I'm here" every minute; clear the tab badge.
  useEffect(() => {
    if (live.connected) void newer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.connected]);
  useEffect(() => {
    const ping = () => void api(`${base}/ping`, { method: "POST" }).catch(() => {});
    ping();
    const t = setInterval(() => document.visibilityState === "visible" && ping(), 60_000);
    const vis = () => {
      if (document.visibilityState === "visible") {
        unseen.current = 0;
        document.title = title;
      }
    };
    vis();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [base, title]);

  // Stay at the bottom as messages arrive (unless reading back); mark what's seen as read.
  const lastSeq = msgs.list[msgs.list.length - 1]?.seq ?? 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs.list.length, msgs.loading]);
  const readTo = useRef(0);
  useEffect(() => {
    if (!lastSeq || lastSeq <= readTo.current || !atBottom.current || document.visibilityState !== "visible") return;
    readTo.current = lastSeq;
    void api(`${base}/read`, { method: "POST", body: { seq: lastSeq } }).catch(() => {});
  }, [lastSeq, base, fresh]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && fresh) setFresh(0);
    if (el.scrollTop < 120 && msgs.hasMore) {
      const h = el.scrollHeight;
      void msgs.older().then(() => requestAnimationFrame(() => (el.scrollTop += el.scrollHeight - h)));
    }
  };
  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setFresh(0);
  };

  const reload = useCallback((m: MessageOut) => {
    void refresh(m.id);
    threadRefresh.current?.(m.id);
  }, [refresh]);
  const ops: Ops = useMemo(
    () => ({
      me: me.userId,
      people,
      channel,
      admin: false,
      guest: true,
      react: (m, emoji, on) => void act(`messages/${m.id}/react`, "POST", { emoji, on }).then(() => reload(m)),
      reply: (m) => setThread(m.parentId ?? m.id),
      edit: (m) => setEditing(m),
      remove: (m) => setDeleting(m),
      pin: () => {},
      save: () => {},
      remind: () => {},
      unread: () => {},
      forward: () => {},
      task: () => {},
      email: null,
      vote: (m, choice, on, note) => void act(`messages/${m.id}/vote`, "POST", { choice, on, note: note ?? "" }).then(() => reload(m)),
      settle: () => {},
      approve: (m, choice) => (choice === "reject" ? setRejecting(m) : void act(`messages/${m.id}/vote`, "POST", { choice: "approve" }, "Approved").then(() => reload(m))),
      calendar: (m) => {
        const d = m.data as { title: string; start: string; end: string; meetingUrl?: string };
        const f = (x: string) => new Date(x).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(d.title)}&dates=${f(d.start)}/${f(d.end)}&details=${encodeURIComponent(d.meetingUrl ?? "")}`, "_blank", "noopener");
      },
      emojiPicker: (m, anchor) => setEmojiFor({ m, r: anchor.getBoundingClientRect() }),
      tag: () => {},
      copyLink: () => {},
      copyText: (m) => void copyText(plain(m.body)).then((ok) => toast(ok ? { tone: "success", title: "Copied" } : { tone: "error", title: "Couldn't copy — your browser blocked it" })),
    }),
    [me.userId, people, channel, act, reload, toast],
  );

  const send = useCallback(async (body: string, files: string[], parentId: string | null) => {
    const r = await act("messages", "POST", { body, files, parentId });
    if (!r) return false;
    const m = (r as { message: MessageOut }).message;
    if (parentId) {
      threadRefresh.current?.(m.id);
      void refresh(parentId);
    } else {
      msgs.setList((l) => merge(l, [m]));
      atBottom.current = true;
    }
    return true;
  }, [act, refresh, msgs]);

  const typing = live.typing.filter((t) => t.u !== me.userId && !t.thread).map((t) => people.get(t.u)?.name.split(" ")[0] ?? "Someone");
  const membersHere = state.people.filter((p) => state.members.includes(p.id));
  const personalKey = store.get(keyStore(channel.id));

  return (
    <div className="flex h-dvh flex-col bg-bg @container/chat">
      <header className="flex min-h-[60px] items-center gap-3 border-b border-border bg-[var(--surface-solid)] px-3 sm:px-4">
        <ConvBadge invite={{ kind: channel.kind, emoji: channel.emoji, color: channel.color }} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{title}</p>
          <p className="truncate text-[12px] text-muted">{state.invite.workspace} · you&apos;re a guest{!live.connected ? " · reconnecting…" : ""}</p>
        </div>
        <button type="button" onClick={() => setPeopleOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12.5px] font-medium hover:bg-surface-2" title="People here">
          <Users className="size-3.5" />{channel.memberCount}
        </button>
        <Menu
          label="Guest options"
          trigger={(p) => <button {...p} type="button" aria-label="More" className="grid size-8 place-items-center rounded-full hover:bg-surface-2"><MoreHorizontal className="size-4" /></button>}
          items={[
            ...(typeof Notification !== "undefined" ? [{ label: notifyOn ? "Notifications are on" : "Notify me of new messages", icon: notifyOn ? <Bell /> : <BellOff />, disabled: notifyOn, onSelect: () => void Notification.requestPermission().then((p) => { setNotifyOn(p === "granted"); if (p !== "granted") toast({ tone: "error", title: "Your browser blocked notifications for this site" }); }) }] : []),
            ...(personalKey ? [{ label: "Copy my link for another device", icon: <Copy />, onSelect: () => void copyText(`${window.location.origin}/j/${code}#k=${personalKey}`).then((ok) => toast(ok ? { tone: "success", title: "Copied — keep it private: it opens the chat as you" } : { tone: "error", title: "Couldn't copy — your browser blocked it" })) }] : []),
            "separator" as const,
            { label: "Leave the conversation", icon: <LogOut />, danger: true, onSelect: () => void api(base, { method: "DELETE" }).then(() => { store.set(keyStore(channel.id), null); refreshState(); }) },
          ]}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2" role="log" aria-live="polite" aria-label={`Messages in ${title}`}>
            {msgs.loading ? (
              <div className="grid place-items-center py-20"><Loader2 className="size-5 animate-spin text-subtle" /></div>
            ) : msgs.error ? (
              <p className="p-6 text-center text-[13px] text-muted">{msgs.error}</p>
            ) : (
              <>
                {!msgs.hasMore && (
                  <div className="px-5 pt-8 pb-4">
                    <ConvBadge invite={{ kind: channel.kind, emoji: channel.emoji, color: channel.color }} size={48} />
                    <h2 className="mt-3 text-[20px] font-semibold">Welcome to {title}, {me.name.split(" ")[0]}</h2>
                    <p className="mt-1 max-w-xl text-[13.5px] text-muted">{(channel.topic || channel.description || `A conversation in ${state.invite.workspace}`).replace(/[.!?]?\s*$/, ".")} {me.history ? "You can read everything said here." : "You see what's said from when you joined."}</p>
                  </div>
                )}
                {msgs.hasMore && <div className="flex justify-center py-3"><Loader2 className="size-4 animate-spin text-subtle" /></div>}
                <List list={msgs.list} ops={ops} base={base} editing={editing?.id ?? null} />
              </>
            )}
          </div>
          <div className="relative">
            {fresh > 0 && (
              <button type="button" onClick={toBottom} className="absolute -top-11 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-fg px-3.5 py-1.5 text-[12.5px] font-semibold text-bg shadow-lg"><ArrowDown className="size-3.5" />{fresh} new</button>
            )}
            <p className={cx("h-5 px-5 text-[11.5px] text-muted transition-opacity", typing.length ? "opacity-100" : "opacity-0")} aria-live="polite">{typing.length ? (typing.length === 1 ? `${typing[0]} is typing…` : `${typing.slice(0, 2).join(" and ")} are typing…`) : " "}</p>
            {channel.archived ? (
              <p className="border-t border-border px-5 py-4 text-center text-[13px] text-muted">This conversation was archived — you can read it, but not write.</p>
            ) : channel.posting === "admins" ? (
              <p className="border-t border-border px-5 py-4 text-center text-[13px] text-muted">Only the conversation&apos;s admins post here.</p>
            ) : (
              <GuestComposer
                key={editing?.id ?? "new"}
                base={base}
                files={me.files}
                placeholder={`Message ${title}`}
                editing={editing}
                onCancelEdit={() => setEditing(null)}
                onSend={async (body, files) => {
                  if (editing) {
                    const ok = await act(`messages/${editing.id}`, "PATCH", { body });
                    if (ok) {
                      reload(editing);
                      setEditing(null);
                    }
                    return !!ok;
                  }
                  return send(body, files, null);
                }}
                onEditLast={() => {
                  const mine = [...msgs.list].reverse().find((m) => m.authorId === me.userId && m.kind === "text" && !m.deleted);
                  if (mine) setEditing(mine);
                }}
              />
            )}
          </div>
        </section>
        {thread && (
          <aside className="fixed inset-0 z-40 flex flex-col bg-[var(--surface-solid)] md:static md:z-auto md:w-[380px] md:shrink-0 md:border-l md:border-border">
            <ThreadPanel key={thread} base={base} rootId={thread} ops={ops} files={me.files} canPost={!channel.archived && channel.posting !== "admins"} typing={live.typing.filter((t) => t.thread === thread && t.u !== me.userId).map((t) => people.get(t.u)?.name.split(" ")[0] ?? "Someone")} register={(f) => (threadRefresh.current = f)} send={(body, files) => send(body, files, thread)} onClose={() => { setThread(null); threadRefresh.current = null; }} />
          </aside>
        )}
      </div>

      {emojiFor && <EmojiPicker anchor={emojiFor.r} onClose={() => setEmojiFor(null)} onPick={(e) => { ops.react(emojiFor.m, e, true); setEmojiFor(null); }} />}
      {deleting && <ConfirmDialog open title="Delete this message?" description="It's removed for everyone. This can't be undone." confirmLabel="Delete" destructive onClose={() => setDeleting(null)} onConfirm={async () => { const m = deleting; setDeleting(null); if (await act(`messages/${m.id}`, "DELETE")) reload(m); }} />}
      {rejecting && <RejectDialog onClose={() => setRejecting(null)} onReject={async (note) => { const m = rejecting; if (await act(`messages/${m.id}/vote`, "POST", { choice: "reject", note }, "Rejected")) { setRejecting(null); reload(m); } }} />}
      {peopleOpen && (
        <Dialog open onClose={() => setPeopleOpen(false)} title={`People in ${title}`} description={`${channel.memberCount} ${channel.memberCount === 1 ? "person" : "people"}`}>
          <ul className="grid max-h-[60vh] gap-1 overflow-y-auto">
            {membersHere.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5">
                <Avatar id={p.id} name={p.name} person={p} size={30} />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-[13.5px] font-medium">{p.name}{p.id === me.userId && <span className="text-muted">(you)</span>}{p.guest && <span className="rounded-full bg-teal-500/12 px-1.5 text-[10.5px] font-semibold text-teal-700 dark:text-teal-300">Guest</span>}</span><span className="block text-[11.5px] text-muted">{presenceOf(p).label}{p.note ? ` · ${p.emoji} ${p.note}` : ""}</span></span>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

/** Messages with day separators, grouped by author within a few minutes. */
function List({ list, ops, base, editing, inThread }: { list: MessageOut[]; ops: Ops; base: string; editing: string | null; inThread?: boolean }) {
  const out: ReactNode[] = [];
  let prev: MessageOut | null = null;
  for (const m of list) {
    const day = dayLabel(m.createdAt);
    if (!prev || dayLabel(prev.createdAt) !== day) {
      out.push(<div key={`d-${m.id}`} className="sticky top-0 z-[1] flex justify-center py-2"><span className="rounded-full border border-border bg-[var(--surface-solid)] px-3 py-0.5 text-[11.5px] font-semibold text-muted">{day}</span></div>);
      prev = null;
    }
    const compact = !!prev && prev.authorId === m.authorId && prev.kind !== "system" && m.kind !== "system" && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS && m.priority === "normal";
    out.push(<div key={m.id} className={cx(editing === m.id && "bg-sky-500/[0.06]")}><Message m={m} ops={ops} compact={compact} base={base} inThread={inThread} /></div>);
    prev = m;
  }
  return <>{out}</>;
}

function ThreadPanel({ base, rootId, ops, files, canPost, typing, register, send, onClose }: { base: string; rootId: string; ops: Ops; files: boolean; canPost: boolean; typing: string[]; register: (f: (id: string) => void) => void; send: (body: string, files: string[]) => Promise<boolean>; onClose: () => void }) {
  const t = useList(base, rootId);
  const { refresh } = t;
  useEffect(() => register((id) => void refresh(id)), [register, refresh]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [t.list.length]);
  const [root, ...replies] = t.list;
  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border px-4">
        <MessageSquareReply className="size-4 text-muted" />
        <p className="flex-1 text-[15px] font-semibold">Thread</p>
        <button type="button" aria-label="Close thread" onClick={onClose} className="grid size-8 place-items-center rounded-full hover:bg-surface-2"><X className="size-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {t.loading ? <div className="grid place-items-center py-16"><Loader2 className="size-5 animate-spin text-subtle" /></div> : t.error ? <p className="p-6 text-center text-[13px] text-muted">{t.error}</p> : (
          <>
            {root && <Message m={root} ops={ops} compact={false} base={base} inThread />}
            <p className="flex items-center gap-2 px-4 py-2 text-[12px] text-muted"><span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span><span className="h-px flex-1 bg-border" /></p>
            <List list={replies} ops={ops} base={base} editing={null} inThread />
          </>
        )}
        <div ref={end} />
      </div>
      <p className={cx("h-5 px-5 text-[11.5px] text-muted", typing.length ? "opacity-100" : "opacity-0")}>{typing.length ? `${typing[0]}${typing.length > 1 ? " and others are" : " is"} typing…` : " "}</p>
      {canPost && <GuestComposer base={base} files={files} thread={rootId} placeholder="Reply…" onSend={send} />}
    </>
  );
}

function GuestComposer({ base, files: canFiles, placeholder, thread = null, editing, onSend, onCancelEdit, onEditLast }: { base: string; files: boolean; placeholder: string; thread?: string | null; editing?: MessageOut | null; onSend: (body: string, files: string[]) => Promise<boolean>; onCancelEdit?: () => void; onEditLast?: () => void }) {
  const toast = useToast();
  const { keys } = useShortcuts();
  const sendHint = keys("enter") ? `${keys("enter")} to send · ${keys("shift+enter")} for a new line` : null;
  const draftKey = `cc-guest-draft:${base}:${thread ?? ""}`;
  const [text, setText] = useState(() => editing?.body ?? store.get(draftKey) ?? "");
  const [files, setFiles] = useState<{ id: string; filename: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [emoji, setEmoji] = useState<DOMRect | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  useEffect(() => {
    if (!editing) store.set(draftKey, text || null);
  }, [text, draftKey, editing]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);
  useEffect(() => {
    if (editing) ta.current?.focus();
  }, [editing]);

  const upload = async (list: FileList | File[]) => {
    for (const f of [...list].slice(0, 10 - files.length)) {
      if (f.size > MAX_FILE) {
        toast({ tone: "error", title: `${f.name} is over 25 MB` });
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const res = await fetch(`${base}/files?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f, headers: { "Content-Type": f.type || "application/octet-stream" }, credentials: "same-origin" });
        const j = (await res.json().catch(() => null)) as { file?: { id: string; filename: string; size: number }; error?: { message: string } } | null;
        if (!res.ok || !j?.file) throw new Error(j?.error?.message ?? "Upload failed");
        setFiles((x) => [...x, j.file!]);
      } catch (e) {
        toast({ tone: "error", title: (e as Error).message });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const submit = async () => {
    const body = text.trim();
    if ((!body && !files.length) || busy || uploading) return;
    setBusy(true);
    const ok = await onSend(body, files.map((f) => f.id));
    setBusy(false);
    if (ok) {
      setText("");
      setFiles([]);
      store.set(draftKey, null);
      ta.current?.focus();
    }
  };
  const typingPing = () => {
    if (Date.now() - lastTyping.current < 3000) return;
    lastTyping.current = Date.now();
    void api(`${base}/typing`, { method: "POST", body: { thread } }).catch(() => {});
  };

  return (
    <div className="px-3 pb-3 sm:px-4" onDragOver={(e) => canFiles && e.preventDefault()} onDrop={(e) => { if (!canFiles) return; e.preventDefault(); void upload(e.dataTransfer.files); }}>
      <div className="rounded-[18px] border border-border bg-[var(--surface-solid)] shadow-sm focus-within:border-fg/30">
        {editing && <p className="flex items-center gap-2 border-b border-border px-3.5 py-1.5 text-[12px] font-medium text-sky-700 dark:text-sky-300">Editing your message<button type="button" onClick={onCancelEdit} className="ml-auto text-muted hover:text-fg">Cancel</button></p>}
        {(files.length > 0 || uploading > 0) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {files.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1.5 rounded-[10px] bg-surface-2 py-1 pr-1 pl-2.5 text-[12px]">
                <Paperclip className="size-3" /><span className="max-w-[180px] truncate">{f.filename}</span><span className="text-muted">{fileSize(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} className="grid size-5 place-items-center rounded-full hover:bg-fg/10"><X className="size-3" /></button>
              </span>
            ))}
            {uploading > 0 && <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-surface-2 px-2.5 py-1 text-[12px] text-muted"><Loader2 className="size-3 animate-spin" />Uploading…</span>}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          maxLength={MAX_BODY}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) typingPing();
          }}
          onPaste={(e) => {
            if (canFiles && e.clipboardData.files.length) {
              e.preventDefault();
              void upload(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape" && editing) onCancelEdit?.();
            else if (e.key === "ArrowUp" && !text && onEditLast) {
              e.preventDefault();
              onEditLast();
            }
          }}
          style={{ outline: "none" }}
          className="block max-h-[220px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-relaxed placeholder:text-subtle"
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          {canFiles && !editing && (
            <>
              <input ref={picker} type="file" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
              <button type="button" aria-label="Attach files" title="Attach files (up to 25 MB)" onClick={() => picker.current?.click()} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><Paperclip className="size-4" /></button>
            </>
          )}
          <button type="button" aria-label="Emoji" onClick={(e) => setEmoji(e.currentTarget.getBoundingClientRect())} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><Smile className="size-4" /></button>
          {sendHint && <span className="ml-auto hidden pr-2 text-[11px] text-subtle sm:inline">{sendHint}</span>}
          <button type="button" aria-label={editing ? "Save" : "Send"} disabled={(!text.trim() && !files.length) || busy || uploading > 0} onClick={() => void submit()} className="grid size-8 place-items-center rounded-full bg-fg text-bg disabled:opacity-30">{busy ? <Loader2 className="size-4 animate-spin" /> : editing ? <Check className="size-4" /> : <SendHorizontal className="size-4" />}</button>
        </div>
      </div>
      {emoji && <EmojiPicker anchor={emoji} onClose={() => setEmoji(null)} onPick={(e) => { setText((t) => t + e); setEmoji(null); ta.current?.focus(); }} />}
    </div>
  );
}

function RejectDialog({ onClose, onReject }: { onClose: () => void; onReject: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onClose={onClose} title="Reject — and say why" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!note.trim()} onClick={() => void onReject(note.trim())}>Reject</Button></>}>
      <Field label="Reason">{(p) => <Textarea {...p} autoFocus rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Dialog>
  );
}
