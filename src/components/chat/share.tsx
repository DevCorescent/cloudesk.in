"use client";

// "Share to chat" from anywhere: any record (an invoice, a deal, a person, a
// purchase order…) goes into a channel or a chat as a card with its key
// details and a link back — with a note and @mentions if you like. Also the
// app shell's Chat layer (live connection) lives here.
import { Check, Hash, Lock, MessagesSquare, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, IconButton, Input, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { ChannelOut, PersonOut } from "@/lib/chat/api";
import { visibleTo } from "@/lib/workspace/modules";
import { SoundProvider } from "@/components/notify/sounds";
import { Avatar, ChatProvider, channelTitle, useChatApi, useChatMeta } from "./shared";

export type ShareCard = { kind: string; id?: string; title: string; sub?: string; link?: string; module?: string; fields?: { label: string; value: string | number | null | undefined }[] };

/** Told where it went, so the record can remember (Mail lists the chats an email was shared in). */
export type ShareOpts = { onShared?: (r: { channelId: string; messageId: string; where: string }) => void };
type Ctx = { available: boolean; share: (card: ShareCard, opts?: ShareOpts) => void };
const ShareCtx = createContext<Ctx>({ available: false, share: () => {} });
export const useShareToChat = () => useContext(ShareCtx);

/** Wraps the app: the live chat connection, and the share dialog. */
export function ChatLayer({ children }: { children: ReactNode }) {
  const { org } = useSession();
  const available = visibleTo(org, "chat");
  const [card, setCard] = useState<{ card: ShareCard; opts?: ShareOpts } | null>(null);
  const share = useCallback((c: ShareCard, opts?: ShareOpts) => setCard({ card: c, opts }), []);
  const value = useMemo(() => ({ available, share }), [available, share]);
  return (
    <ChatProvider>
      <SoundProvider>
        <ShareCtx.Provider value={value}>
          {children}
          {card && available && <ShareDialog card={card.card} opts={card.opts} onClose={() => setCard(null)} />}
        </ShareCtx.Provider>
      </SoundProvider>
    </ChatProvider>
  );
}

function ShareDialog({ card, opts, onClose }: { card: ShareCard; opts?: ShareOpts; onClose: () => void }) {
  const meta = useChatMeta();
  const { call } = useChatApi();
  const toast = useToast();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [to, setTo] = useState<{ channel?: string; person?: string } | null>(null);
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = useMemo(() => new Map((meta.data?.people ?? []).map((p) => [p.id, p])), [meta.data?.people]);
  const lq = q.toLowerCase();
  const convs: ChannelOut[] = (meta.data?.channels ?? []).filter((c) => c.member && !c.archived && !(c.posting === "admins" && c.role === "member" && !meta.data?.me.admin) && channelTitle(c, people).toLowerCase().includes(lq)).slice(0, 30);
  const loners: PersonOut[] = (meta.data?.people ?? []).filter((p) => p.id !== meta.data?.me.id && !meta.data?.channels.some((c) => c.kind === "dm" && c.people[0] === p.id) && `${p.name} ${p.email}`.toLowerCase().includes(lq)).slice(0, 8);
  const go = async () => {
    if (!to) return;
    setBusy(true);
    try {
      const channelId = to.channel ?? (await call<{ channel: { id: string } }>(`dm/${to.person}`, "POST")).channel.id;
      const fields = (card.fields ?? []).filter((f) => f.value !== null && f.value !== undefined && String(f.value).trim()).slice(0, 12).map((f) => ({ label: f.label.slice(0, 60), value: String(f.value).slice(0, 200) }));
      const sent = await call<{ message: { id: string } }>(`channels/${channelId}/messages`, "POST", { body: note.trim(), priority: urgent ? "urgent" : "normal", record: { kind: card.kind, id: card.id ?? "", title: card.title.slice(0, 200), sub: (card.sub ?? "").slice(0, 300), link: card.link ?? (typeof location !== "undefined" ? location.pathname : ""), module: card.module ?? "", fields } });
      const ch = meta.data?.channels.find((c) => c.id === channelId);
      const where = ch ? (ch.kind === "channel" ? `#${ch.name}` : channelTitle(ch, people)) : (meta.data?.people.find((p) => p.id === to.person)?.name ?? "a chat");
      opts?.onShared?.({ channelId, messageId: sent.message.id, where });
      toast({ tone: "success", title: "Shared in Chat", description: "Open it to keep the conversation going." });
      if (open) router.push(`/chat/${channelId}`);
      onClose();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't share", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" title="Share to chat" footer={<><label className="mr-auto flex items-center gap-2 text-[12.5px]"><Switch label="Open the chat" checked={open} onChange={setOpen} /> Open the chat after</label><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!to} onClick={() => void go()}>Share</Button></>}>
      <div className="grid gap-3">
        <div className="flex overflow-hidden rounded-[14px] border border-border">
          <span className="w-1 bg-gradient-to-b from-violet-500 to-sky-500" />
          <div className="min-w-0 flex-1 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">{card.module || card.kind}</p>
            <p className="truncate text-[14px] font-semibold">{card.title}</p>
            {card.sub && <p className="truncate text-[12.5px] text-muted">{card.sub}</p>}
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Channel, chat or person" aria-label="Share with" className="pl-8" />
        </div>
        <ul className="max-h-60 overflow-y-auto rounded-[12px] border border-border p-1">
          {!meta.data && <li className="p-3 text-[13px] text-muted">Loading…</li>}
          {convs.map((c) => {
            const on = to?.channel === c.id;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setTo({ channel: c.id })} className={cx("flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left text-[13.5px] hover:bg-surface-2", on && "bg-sky-500/10 font-medium")}>
                  {c.kind === "dm" ? <Avatar id={c.people[0] ?? ""} name={channelTitle(c, people)} person={people.get(c.people[0] ?? "")} size={24} /> : <span className="grid size-6 place-items-center rounded-[7px] text-[11px] text-white" style={{ background: c.kind === "group" ? "#7c3aed" : c.color }}>{c.kind === "group" ? <Users className="size-3" /> : c.emoji || (c.visibility === "private" ? <Lock className="size-3" /> : <Hash className="size-3" />)}</span>}
                  <span className="flex-1 truncate">{c.kind === "channel" ? `#${c.name}` : channelTitle(c, people)}</span>
                  {on && <Check className="size-4 text-sky-600" />}
                </button>
              </li>
            );
          })}
          {loners.map((p) => {
            const on = to?.person === p.id;
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setTo({ person: p.id })} className={cx("flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left text-[13.5px] hover:bg-surface-2", on && "bg-sky-500/10 font-medium")}>
                  <Avatar id={p.id} name={p.name} person={p} size={24} /><span className="flex-1 truncate">{p.name}</span><span className="text-[11px] text-subtle">new chat</span>{on && <Check className="size-4 text-sky-600" />}
                </button>
              </li>
            );
          })}
          {meta.data && !convs.length && !loners.length && <li className="p-3 text-center text-[13px] text-muted">Nothing matches</li>}
        </ul>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional) — e.g. Can someone follow up on this today?" aria-label="Note to send with it" maxLength={4000} />
        <label className="flex items-center gap-2 text-[12.5px]"><Switch label="Urgent" checked={urgent} onChange={setUrgent} /> Mark urgent (notifies until read)</label>
      </div>
    </Dialog>
  );
}

/** The button on a record: "Share" into Chat. Hidden when Chat isn't on. */
export function ShareToChatButton({ card, label = "Share", size = "sm", iconOnly }: { card: ShareCard; label?: string; size?: "sm" | "md"; iconOnly?: boolean }) {
  const { available, share } = useShareToChat();
  if (!available) return null;
  return iconOnly ? <IconButton size={size} label="Share to chat" icon={<MessagesSquare className="size-4" />} onClick={() => share(card)} /> : <Button size={size} variant="secondary" icon={<MessagesSquare className="size-3.5" />} onClick={() => share(card)} title="Share to chat" aria-label="Share to chat">{label}</Button>;
}
