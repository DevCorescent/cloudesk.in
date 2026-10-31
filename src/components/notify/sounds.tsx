"use client";

// Notification sounds: which tune plays for what, and when to stay quiet
// (sounds off, quiet hours, Do not disturb, or you're already looking).
// Watches the things that notify: the bell (meetings, approvals, tasks…),
// live chat (each new message is classified — mention, direct, urgent or a
// plain channel message), and new mail in your inboxes. Settings are per
// device, like the volume of a speaker.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { chatKey, useChatApi, useChatLive } from "@/components/chat/shared";
import { useNotifications } from "@/components/notify/bell";
import { useSession } from "@/components/shell/session-context";
import { Button, Card, Input, Select, Switch, cx } from "@/components/ui/primitives";
import type { MessageOut, MetaOut as ChatMeta } from "@/lib/chat/api";
import { claim, DEFAULT_SOUNDS, inQuietHours, loadSounds, playTune, PURPOSES, saveSounds, TUNES, unlockSounds, type Purpose, type SoundSettings } from "@/lib/client/sounds";
import { api } from "@/lib/client/api";
import type { MetaOut as MailMeta } from "@/lib/mail/api";
import { visibleTo } from "@/lib/workspace/modules";

type Ctx = { settings: SoundSettings; set: (s: SoundSettings) => void; play: (p: Purpose, key: string) => void; preview: (tune: string) => void };
const SoundCtx = createContext<Ctx>({ settings: DEFAULT_SOUNDS, set: () => {}, play: () => {}, preview: () => {} });
export const useSounds = () => useContext(SoundCtx);

/** Which tune a bell notification gets (chat ones come from the live stream instead). */
export function purposeOf(kind: string): Purpose | null {
  if (kind.startsWith("chat.")) return null;
  if (kind.startsWith("calendar.")) return "calendar";
  if (kind.startsWith("mail.")) return "mail";
  if (/^(approval|work|hr|documents|grc|portal)\./.test(kind)) return "approvals";
  if (kind === "reminder") return "calendar";
  return "general";
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const { user, org } = useSession();
  const qc = useQueryClient();
  const [settings, setSettings] = useState<SoundSettings>(DEFAULT_SOUNDS);
  useEffect(() => {
    const load = () => setSettings(loadSounds(user.id));
    load();
    window.addEventListener("cc-sounds-changed", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("cc-sounds-changed", load);
      window.removeEventListener("storage", load);
    };
  }, [user.id]);
  const set = useCallback((s: SoundSettings) => {
    setSettings(s);
    saveSounds(user.id, s);
  }, [user.id]);
  const ref = useRef(settings);
  useEffect(() => {
    ref.current = settings;
  }, [settings]);
  const play = useCallback(
    (p: Purpose, key: string) => {
      const s = ref.current;
      if (!s.on) return;
      const urgent = p === "chatUrgent";
      if (!urgent && inQuietHours(s.quiet)) return;
      if (!urgent && s.respectDnd) {
        const chat = qc.getQueryData<ChatMeta>(chatKey(org.id, "meta"));
        if (chat?.me.status === "dnd") return;
      }
      if (s.backgroundOnly && !urgent && document.visibilityState === "visible" && document.hasFocus()) return;
      if (!claim(key)) return;
      playTune(s.tunes[p], s.volume);
    },
    [qc, org.id],
  );
  const preview = useCallback((tune: string) => {
    unlockSounds();
    playTune(tune, ref.current.volume || 0.7);
  }, []);
  const value = useMemo(() => ({ settings, set, play, preview }), [settings, set, play, preview]);
  return (
    <SoundCtx.Provider value={value}>
      {children}
      <BellWatcher />
      {visibleTo(org, "chat") && <ChatWatcher />}
      {visibleTo(org, "mail") && <MailWatcher />}
    </SoundCtx.Provider>
  );
}

/** New bell notifications (not chat — that's live): one sound per batch, the most important purpose wins. */
function BellWatcher() {
  const q = useNotifications();
  const { play } = useSounds();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const items = q.data?.items;
    if (!items) return;
    if (!seen.current) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !seen.current!.has(i.id) && !i.readAt);
    items.forEach((i) => seen.current!.add(i.id));
    const order: Purpose[] = ["calendar", "approvals", "mail", "general"];
    const purposes = fresh.map((i) => purposeOf(i.kind)).filter((p): p is Purpose => !!p);
    const top = order.find((p) => purposes.includes(p));
    if (top) play(top, `bell:${fresh[0]!.id}`);
  }, [q.data, play]);
  return null;
}

/** Live chat: new messages from others, classified the way you'd want to hear them. */
function ChatWatcher() {
  const live = useChatLive();
  const { call, orgId } = useChatApi();
  const qc = useQueryClient();
  const { user } = useSession();
  const { play } = useSounds();
  const pathname = usePathname();
  const where = useRef(pathname);
  useEffect(() => {
    where.current = pathname;
  }, [pathname]);
  const seen = useRef(new Set<string>());
  useEffect(
    () =>
      live.on((e) => {
        if (e.type !== "m" || !e.id || !e.ch || seen.current.has(e.id)) return;
        seen.current.add(e.id);
        const known = qc.getQueryData<ChatMeta>(chatKey(orgId, "meta"))?.channels.find((x) => x.id === e.ch);
        // A conversation that's new to this tab (someone just started a DM with you): fetch the list first.
        const channel = known ? Promise.resolve(known) : qc.fetchQuery({ queryKey: chatKey(orgId, "meta"), queryFn: () => call<ChatMeta>("meta") }).then((m) => m.channels.find((x) => x.id === e.ch));
        void channel
          .then(async (c) => {
            if (!c?.member || c.notify === "none") return;
            const { message: m } = await call<{ message: MessageOut }>(`messages/${e.id}`);
            // Only brand-new messages from someone else (edits and reactions send the same event).
            if (m.authorId === user.id || !m.authorId || m.kind === "system" || m.deleted || m.editedAt || Date.now() - Date.parse(m.createdAt) > 60_000) return;
            const urgent = m.priority === "urgent";
            const mention = m.mentions.users.includes(user.id) || m.mentions.everyone;
            const direct = c.kind !== "channel";
            const looking = where.current === `/chat/${c.id}` && document.visibilityState === "visible" && document.hasFocus();
            if (looking && !urgent && !mention) return;
            if (urgent) return play("chatUrgent", `chat:${m.id}`);
            if (mention) return play("chatMention", `chat:${m.id}`);
            if (direct) return play("chatDirect", `chat:${m.id}`);
            if (c.notify === "all" && !m.parentId) play("chatMessage", `chat:${m.id}`);
          })
          .catch(() => {});
      }),
    [live, call, orgId, qc, user.id, play],
  );
  return null;
}

/** New mail: the unread count in your inboxes went up. */
function MailWatcher() {
  const { org } = useSession();
  const { play } = useSounds();
  const q = useMailBadge();
  const last = useRef<number | null>(null);
  const unread = q.data?.counts.all?.unread;
  useEffect(() => {
    if (unread === undefined) return;
    if (last.current !== null && unread > last.current) play("mail", `mail:${org.id}:${unread}`);
    last.current = unread;
  }, [unread, play, org.id]);
  return null;
}

/** Mail's counts for the sidebar badge (the same query the Mail screens use). */
export function useMailBadge() {
  const { org } = useSession();
  return useQuery({ queryKey: ["mail", org.id, "meta"], queryFn: () => api<MailMeta>(`/api/v1/orgs/${org.id}/mail/meta`), refetchInterval: 30_000, retry: false, enabled: visibleTo(org, "mail") });
}

// ── Settings ────────────────────────────────────────────────────────────────

export function SoundSettingsCard() {
  const { settings: s, set, preview } = useSounds();
  const [playing, setPlaying] = useState<string | null>(null);
  const hear = (tune: string) => {
    preview(tune);
    setPlaying(tune);
    setTimeout(() => setPlaying((p) => (p === tune ? null : p)), 1200);
  };
  const patch = (p: Partial<SoundSettings>) => set({ ...s, ...p });
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Sounds</h2>
          <p className="mt-0.5 max-w-xl text-[13px] text-muted">A tune for each kind of notification. These are set for this browser on this device — like your speaker&apos;s volume. Sounds play while Cloudesk is open in a tab.</p>
        </div>
        <label className="flex items-center gap-2 text-[13px] font-medium"><Switch label="Sounds" checked={s.on} onChange={(on) => patch({ on })} /> {s.on ? "On" : "Off"}</label>
      </div>

      <div className={cx("mt-5 grid gap-5", !s.on && "pointer-events-none opacity-50")}>
        <div className="flex items-center gap-3">
          {s.volume > 0 ? <Volume2 className="size-4 text-muted" /> : <VolumeX className="size-4 text-muted" />}
          <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => patch({ volume: Number(e.target.value) })} aria-label="Volume" className="w-56 accent-[var(--accent)]" />
          <span className="w-10 text-[12.5px] text-muted tabular-nums">{Math.round(s.volume * 100)}%</span>
        </div>

        <div className="overflow-hidden rounded-[16px] border border-border">
          {PURPOSES.map((p, i) => (
            <div key={p.id} className={cx("grid items-center gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]", i > 0 && "border-t border-border")}>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">{p.label}</p>
                <p className="text-[12px] text-muted">{p.hint}</p>
              </div>
              <Select aria-label={`Tune for ${p.label}`} value={s.tunes[p.id]} onChange={(e) => { patch({ tunes: { ...s.tunes, [p.id]: e.target.value } }); if (e.target.value !== "none") hear(e.target.value); }}>
                {TUNES.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.mood.split(" — ")[1] ?? t.mood}</option>)}
                <option value="none">No sound</option>
              </Select>
              <Button size="sm" variant="ghost" disabled={s.tunes[p.id] === "none"} icon={playing === s.tunes[p.id] ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} onClick={() => hear(s.tunes[p.id])}>Play</Button>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium">All tunes</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TUNES.map((t) => (
              <button key={t.id} type="button" onClick={() => hear(t.id)} className={cx("flex items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition-colors", playing === t.id ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-border hover:bg-surface-2")}>
                <span className={cx("grid size-8 shrink-0 place-items-center rounded-full", playing === t.id ? "bg-[var(--accent)] text-white" : "bg-surface-2")}>{playing === t.id ? <Wave /> : <Play className="size-3.5" />}</span>
                <span className="min-w-0"><span className="block text-[13.5px] font-semibold">{t.name}</span><span className="block truncate text-[12px] text-muted">{t.mood}</span></span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 border-t border-border pt-4">
          <label className="flex items-start gap-2.5 text-[13px]"><Switch label="Respect Do not disturb" checked={s.respectDnd} onChange={(respectDnd) => patch({ respectDnd })} /><span><b className="font-medium">Silent in Do not disturb</b><span className="block text-[12px] text-muted">While your Chat status is Do not disturb — urgent messages still play.</span></span></label>
          <label className="flex items-start gap-2.5 text-[13px]"><Switch label="Only in the background" checked={s.backgroundOnly} onChange={(backgroundOnly) => patch({ backgroundOnly })} /><span><b className="font-medium">Only when I&apos;m not looking at Cloudesk</b><span className="block text-[12px] text-muted">Skip sounds while this window is in front of you.</span></span></label>
          <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
            <Switch label="Quiet hours" checked={s.quiet.on} onChange={(on) => patch({ quiet: { ...s.quiet, on } })} />
            <b className="font-medium">Quiet hours</b>
            <Input type="time" value={s.quiet.from} onChange={(e) => patch({ quiet: { ...s.quiet, from: e.target.value } })} aria-label="Quiet from" className="h-8 !w-28" disabled={!s.quiet.on} />
            <span className="text-muted">to</span>
            <Input type="time" value={s.quiet.to} onChange={(e) => patch({ quiet: { ...s.quiet, to: e.target.value } })} aria-label="Quiet until" className="h-8 !w-28" disabled={!s.quiet.on} />
            <span className="text-[12px] text-muted">(urgent chat messages still play)</span>
          </div>
          <div><Button size="sm" variant="ghost" onClick={() => set(DEFAULT_SOUNDS)}>Reset to the defaults</Button></div>
        </div>
      </div>
    </Card>
  );
}

function Wave() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => <span key={i} className="w-[2.5px] animate-pulse rounded-full bg-white" style={{ height: `${[60, 100, 75, 45][i]}%`, animationDelay: `${i * 0.12}s` }} />)}
    </span>
  );
}
