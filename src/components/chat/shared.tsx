"use client";

// Shared pieces of Chat: the API for the workspace, the live connection
// (one per tab, from the app shell — it keeps unread counts current
// everywhere and tells open conversations what changed), presence, avatars
// and time formats.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Lock, Users } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import type { ChannelOut, MetaOut, PersonOut } from "@/lib/chat/api";
import { STATUS_LABEL, type Status } from "@/lib/chat/model";
import { visibleTo } from "@/lib/workspace/modules";

export const chatKey = (orgId: string, ...rest: unknown[]) => ["chat", orgId, ...rest];

export function useChatApi() {
  const { org } = useSession();
  const base = `/api/v1/orgs/${org.id}/chat`;
  const call = useCallback(<T,>(path: string, method = "GET", body?: unknown) => api<T>(`${base}/${path}`, method === "GET" || method === "DELETE" ? { method } : { method, body: body ?? {} }), [base]);
  return { orgId: org.id, base, call };
}

export function useChatMeta(enabled = true) {
  const { orgId, call } = useChatApi();
  return useQuery({ queryKey: chatKey(orgId, "meta"), queryFn: () => call<MetaOut>("meta"), refetchInterval: 60_000, enabled, retry: false, staleTime: 5_000 });
}

export type LiveEvent = { type: "m" | "r" | "t" | "p" | "c"; ch?: string; id?: string; seq?: number; u?: string; thread?: string | null; n?: 1; me?: string[] };

/** The sidebar refreshes at most this often from live events (the counts update at once from the event itself). */
const META_EVERY_MS = 2500;

/** A new message, applied to the cached sidebar straight away: unread, mentions, order. */
function patchMeta(m: MetaOut, e: LiveEvent): MetaOut {
  const i = m.channels.findIndex((c) => c.id === e.ch);
  const c = m.channels[i];
  if (!c || e.thread) return m;
  const mine = e.u === m.me.id;
  const looking = typeof document !== "undefined" && document.visibilityState === "visible" && window.location.pathname === `/chat/${c.id}`;
  const counts = c.member && !mine && !looking;
  const unread = counts && c.notify !== "none" ? c.unread + 1 : c.unread;
  const mentioned = counts && (c.kind === "dm" || !!e.me?.includes(m.me.id) || !!e.me?.includes("*"));
  const next = { ...c, unread, mentions: c.mentions + (mentioned ? 1 : 0), lastMessageAt: new Date().toISOString() };
  const channels = [...m.channels];
  channels[i] = next;
  return { ...m, channels, counts: { ...m.counts, unread: m.counts.unread + (unread - c.unread), mentions: m.counts.mentions + (mentioned ? 1 : 0), activity: m.counts.activity + (mentioned ? 1 : 0) } };
}
type Live = { connected: boolean; on: (f: (e: LiveEvent) => void) => () => void; typing: Record<string, { u: string; thread: string | null; at: number }[]>; enabled: boolean };
const LiveCtx = createContext<Live>({ connected: false, on: () => () => {}, typing: {}, enabled: false });
export const useChatLive = () => useContext(LiveCtx);

/** Mounted once in the app shell: live events, presence pings, and fresh unread counts. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { org } = useSession();
  const enabled = visibleTo(org, "chat");
  const qc = useQueryClient();
  const { base, call, orgId } = useChatApi();
  const listeners = useRef(new Set<(e: LiveEvent) => void>());
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState<Live["typing"]>({});

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let stopped = false;
    let refetch: ReturnType<typeof setTimeout> | null = null;
    let lastMeta = 0;
    // Many events in a burst (a busy channel, many people coming online) make one refetch, not one each.
    const meta = () => {
      if (refetch) return;
      refetch = setTimeout(() => {
        refetch = null;
        lastMeta = Date.now();
        void qc.invalidateQueries({ queryKey: chatKey(orgId, "meta") });
      }, Math.max(300, META_EVERY_MS - (Date.now() - lastMeta)));
    };
    const open = () => {
      if (stopped) return;
      es = new EventSource(`${base}/stream`);
      es.addEventListener("hello", () => setConnected(true));
      es.onerror = () => setConnected(false);
      for (const type of ["m", "r", "t", "p", "c"] as const)
        es.addEventListener(type, (ev) => {
          const d = JSON.parse((ev as MessageEvent).data) as Omit<LiveEvent, "type">;
          const e = { type, ...d } as LiveEvent;
          if (type === "t" && e.ch && e.u) {
            setTyping((t) => ({ ...t, [e.ch!]: [...(t[e.ch!] ?? []).filter((x) => x.u !== e.u || x.thread !== (e.thread ?? null)), { u: e.u!, thread: e.thread ?? null, at: Date.now() }] }));
          } else if (type === "m" && e.ch) {
            // Whoever posted has stopped typing.
            setTyping((t) => (t[e.ch!]?.length ? { ...t, [e.ch!]: [] } : t));
          }
          if (type === "m" && e.n) qc.setQueryData<MetaOut>(chatKey(orgId, "meta"), (old) => (old ? patchMeta(old, e) : old));
          // Someone else reading only changes "seen by", which the open conversation handles itself.
          if (type !== "t" && !(type === "r" && e.u !== qc.getQueryData<MetaOut>(chatKey(orgId, "meta"))?.me.id)) meta();
          listeners.current.forEach((f) => f(e));
        });
    };
    open();
    // Presence: "I'm here" every minute while the tab is open.
    const ping = () => void call("presence/ping", "POST").catch(() => {});
    ping();
    const pi = setInterval(() => document.visibilityState === "visible" && ping(), 60_000);
    // Typing indicators fade after 6 seconds.
    const ti = setInterval(() => setTyping((t) => {
      const now = Date.now();
      let changed = false;
      const next = Object.fromEntries(Object.entries(t).map(([k, v]) => {
        const kept = v.filter((x) => now - x.at < 6000);
        if (kept.length !== v.length) changed = true;
        return [k, kept];
      }));
      return changed ? next : t;
    }), 2000);
    return () => {
      stopped = true;
      es?.close();
      clearInterval(pi);
      clearInterval(ti);
      if (refetch) clearTimeout(refetch);
    };
  }, [enabled, base, call, orgId, qc]);

  const on = useCallback((f: (e: LiveEvent) => void) => {
    listeners.current.add(f);
    return () => void listeners.current.delete(f);
  }, []);
  const value = useMemo(() => ({ connected, on, typing, enabled }), [connected, on, typing, enabled]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

// ── People ──────────────────────────────────────────────────────────────────

const PALETTE = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#0891b2", "#4f46e5"];
export const colorFor = (s: string) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]!;
export const initialsOf = (name: string) => {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
};

export const STATUS_TONE: Record<Status, string> = { available: "bg-emerald-500", busy: "bg-red-500", dnd: "bg-red-600", away: "bg-amber-400" };

/** What the dot means: their status, "in a meeting" from their calendar, or offline. */
export function presenceOf(p: Pick<PersonOut, "status" | "online" | "inMeeting"> | undefined): { tone: string; label: string } {
  if (!p) return { tone: "bg-zinc-400", label: "Unknown" };
  if (p.status === "dnd") return { tone: STATUS_TONE.dnd, label: STATUS_LABEL.dnd };
  if (p.inMeeting) return { tone: STATUS_TONE.busy, label: `In a meeting` };
  if (p.status !== "available") return { tone: STATUS_TONE[p.status], label: STATUS_LABEL[p.status] };
  return p.online ? { tone: STATUS_TONE.available, label: "Available" } : { tone: "bg-zinc-300 dark:bg-zinc-600", label: "Offline" };
}

export function Avatar({ name, id, size = 32, person, ring }: { name: string; id: string; size?: number; person?: PersonOut; ring?: boolean }) {
  const pr = person ? presenceOf(person) : null;
  const dot = Math.max(8, Math.round(size * 0.3));
  return (
    <span className="relative inline-grid shrink-0" style={{ width: size, height: size }}>
      <span aria-hidden className={cx("grid place-items-center rounded-full font-semibold text-white select-none", ring && "ring-2 ring-[var(--surface-solid)]")} style={{ width: size, height: size, fontSize: size * 0.38, background: colorFor(id || name) }}>
        {initialsOf(name)}
      </span>
      {pr && (
        <span title={pr.label} className={cx("absolute right-[-1px] bottom-[-1px] rounded-full ring-2 ring-[var(--surface-solid)]", pr.tone)} style={{ width: dot, height: dot }}>
          {person?.status === "dnd" && <span className="absolute inset-x-[22%] top-1/2 h-[2px] -translate-y-1/2 rounded bg-white" />}
        </span>
      )}
    </span>
  );
}

export function usePeople() {
  const meta = useChatMeta();
  return usePeopleMap(meta.data);
}

/** Everyone whose name can show (guests too), with you always shown as here. */
export function usePeopleMap(meta: MetaOut | undefined) {
  const me = meta?.me.id;
  return useMemo(() => new Map([...(meta?.guests ?? []), ...(meta?.people ?? [])].map((p) => [p.id, p.id === me ? { ...p, online: true } : p])), [meta?.guests, meta?.people, me]);
}

// ── Time ────────────────────────────────────────────────────────────────────

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const longWhen = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
export function shortWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(iso);
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6 && days > 0) return d.toLocaleDateString("en-IN", { weekday: "short" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
export const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The name a conversation goes by, for you. */
export function channelTitle(c: { kind: string; name: string; people: string[] }, people: Map<string, PersonOut>) {
  if (c.kind === "channel") return c.name;
  if (c.kind === "group" && c.name) return c.name;
  const names = c.people.map((u) => people.get(u)?.name ?? "Someone");
  if (c.kind === "dm") return names[0] ?? "Just you";
  return names.length > 3 ? `${names.slice(0, 3).map((n) => n.split(" ")[0]).join(", ")} +${names.length - 3}` : names.map((n) => n.split(" ")[0]).join(", ");
}

/**
 * A conversation's icon: the other person for a direct message; otherwise its
 * picture when its admins have set one, or its colour and emoji (a channel) or
 * the group glyph. Corners and glyphs scale with the size.
 */
export function ConvIcon({ c, people, size = 22, className }: { c: ChannelOut; people: Map<string, PersonOut>; size?: number; className?: string }) {
  const { base } = useChatApi();
  if (c.kind === "dm") return <Avatar id={c.people[0] ?? c.id} name={channelTitle(c, people)} person={people.get(c.people[0] ?? "")} size={size} />;
  const radius = size >= 56 ? Math.round(size * 0.3) : size > 28 ? Math.round(size * 0.3) : 7;
  const box = { width: size, height: size, borderRadius: radius };
  // eslint-disable-next-line @next/next/no-img-element -- a private chat file, served by the chat API with the session cookie
  if (c.avatar) return <img src={`${base}/files/${c.avatar}`} alt="" className={cx("shrink-0 bg-surface-2 object-cover shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]", className)} style={box} />;
  const glyph = { width: Math.round(size * 0.5), height: Math.round(size * 0.5) };
  if (c.kind === "group") return <span className={cx("grid shrink-0 place-items-center bg-gradient-to-br from-violet-500 to-sky-500 text-white", className)} style={box}><Users style={glyph} /></span>;
  return <span className={cx("grid shrink-0 place-items-center text-white", className)} style={{ ...box, background: c.color, fontSize: Math.max(12, Math.round(size * 0.5)) }}>{c.emoji || (c.visibility === "private" ? <Lock style={glyph} /> : <Hash style={glyph} />)}</span>;
}
