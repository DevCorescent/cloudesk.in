"use client";

// Email waiting for a reply, answered right in AI mode: a one-tap quick reply
// sends at once (with a few seconds to undo), "Draft" writes a reply with AI
// for a look and a tweak, "Draft all" does every one, and "Send all" sends
// the drafts. Done and Later put an email away without answering it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Archive, ArrowUpRight, Clock, Loader2, Send, Sparkles, Undo2, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";

type Item = { id: string; subject: string; from: { name: string; address: string }; snippet: string; waitingSince: string | null; unread: boolean };
type Row = { draft?: string; drafting?: boolean; sending?: boolean; sent?: { messageId: string; left: number }; gone?: "sent" | "done" | "later"; error?: string; quick?: boolean };
type Tone = "friendly" | "formal" | "short";

const first = (name: string, address: string) => (name.trim().split(/\s+/)[0] || address.split("@")[0] || "there").replace(/^./, (c) => c.toUpperCase());
const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

/** One-tap replies: polite, complete, and safe to send without reading twice. */
const QUICK: { label: string; body: (to: string, me: string) => string }[] = [
  { label: "Received, will revert", body: (to, me) => `Dear ${to},\n\nThank you for your email. I have received it and will get back to you shortly.\n\nBest regards,\n${me}` },
  { label: "Will reply by end of day", body: (to, me) => `Dear ${to},\n\nThank you for writing in. I am looking into this and will respond in detail by the end of the day.\n\nBest regards,\n${me}` },
  { label: "Let's set up a call", body: (to, me) => `Dear ${to},\n\nThank you for your email. It would be easiest to discuss this over a short call. Please let me know a time that suits you, and I will send an invite.\n\nBest regards,\n${me}` },
  { label: "Please share details", body: (to, me) => `Dear ${to},\n\nThank you for reaching out. Could you please share a few more details so that I can assist you better?\n\nBest regards,\n${me}` },
  { label: "Confirmed, thank you", body: (to, me) => `Dear ${to},\n\nThank you — this is confirmed from our side.\n\nBest regards,\n${me}` },
];
const UNDO_S = 9;

export function InboxCard({ orgId, me, onAsk }: { orgId: string; me: string; onAsk: (prompt: string) => void }) {
  const qc = useQueryClient();
  const key = ["copilot", orgId, "inbox"];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ connected: boolean; items: Item[] }>(`/api/v1/orgs/${orgId}/copilot/inbox`), staleTime: 60_000, retry: false });
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [tone, setTone] = useState<Tone>("friendly");
  const [bulk, setBulk] = useState<"" | "drafting" | "sending">("");
  const base = `/api/v1/orgs/${orgId}/copilot`;
  const patch = (id: string, r: Partial<Row>) => setRows((x) => ({ ...x, [id]: { ...x[id], ...r } }));
  const myName = me.split(" ")[0] || me;

  // The undo window counts down; after it, a sent reply leaves the list.
  const counting = Object.values(rows).some((r) => r.sent && r.sent.left > 0);
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRows((x) => Object.fromEntries(Object.entries(x).map(([k, r]) => [k, r.sent && r.sent.left > 0 ? { ...r, sent: { ...r.sent, left: r.sent.left - 1 } } : r]))), 1000);
    return () => clearInterval(t);
  }, [counting]);

  if (q.isLoading || !q.data?.connected) return null;
  const items = q.data.items.filter((i) => rows[i.id]?.gone !== "done" && rows[i.id]?.gone !== "later" && !(rows[i.id]?.sent && rows[i.id]!.sent!.left <= 0));
  if (!q.data.items.length)
    return (
      <div className="ai-inbox is-clear">
        <p>
          <b>Inbox zero.</b> Nothing is waiting for your reply.
        </p>
      </div>
    );
  if (!items.length)
    return (
      <div className="ai-inbox is-clear">
        <p>
          <b>All caught up.</b> Every email waiting for you has been handled.
        </p>
        <button type="button" className="ai-chip" onClick={() => (setRows({}), void qc.invalidateQueries({ queryKey: key }))}>
          Check again
        </button>
      </div>
    );

  const draft = async (i: Item, t: Tone = tone) => {
    patch(i.id, { drafting: true, error: undefined, quick: false });
    try {
      const r = await api<{ draft: string }>(`${base}/inbox/${i.id}/draft`, { method: "POST", body: { tone: t } });
      patch(i.id, { drafting: false, draft: r.draft });
    } catch (e) {
      patch(i.id, { drafting: false, error: errorMessage(e) });
    }
  };
  const send = async (i: Item, body: string) => {
    if (!body.trim()) return;
    patch(i.id, { sending: true, error: undefined, quick: false });
    try {
      const r = await api<{ messageId: string }>(`${base}/inbox/${i.id}/reply`, { method: "POST", body: { body } });
      patch(i.id, { sending: false, sent: { messageId: r.messageId, left: UNDO_S } });
      void qc.invalidateQueries({ queryKey: ["copilot", orgId, "briefing"] });
    } catch (e) {
      patch(i.id, { sending: false, error: errorMessage(e) });
    }
  };
  const undo = async (i: Item) => {
    const m = rows[i.id]?.sent;
    if (!m) return;
    try {
      const r = await api<{ draft: { body: string } }>(`${base}/sent/${m.messageId}/undo`, { method: "POST" });
      patch(i.id, { sent: undefined, draft: r.draft.body });
    } catch (e) {
      patch(i.id, { error: errorMessage(e) });
    }
  };
  const settle = async (i: Item, action: "done" | "later") => {
    patch(i.id, { gone: action });
    try {
      await api(`${base}/inbox/${i.id}/settle`, { method: "POST", body: { action } });
      void qc.invalidateQueries({ queryKey: ["copilot", orgId, "briefing"] });
    } catch (e) {
      patch(i.id, { gone: undefined, error: errorMessage(e) });
    }
  };
  const open = items.filter((i) => !rows[i.id]?.sent);
  const drafted = open.filter((i) => rows[i.id]?.draft?.trim());
  const draftAll = async () => {
    setBulk("drafting");
    for (const i of open.filter((x) => !rows[x.id]?.draft).slice(0, 6)) await draft(i);
    setBulk("");
  };
  const sendAll = async () => {
    setBulk("sending");
    for (const i of drafted) await send(i, rows[i.id]!.draft!);
    setBulk("");
  };

  return (
    <div className="ai-inbox">
      <div className="ai-inbox-h">
        <span>
          <b>Waiting for your reply</b>
          <small>{open.length} email{open.length === 1 ? "" : "s"}</small>
        </span>
        <div className="ai-inbox-bulk">
          {drafted.length > 1 ? (
            <button type="button" className="ai-btn" disabled={!!bulk} onClick={() => void sendAll()}>
              {bulk === "sending" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send {drafted.length} drafts
            </button>
          ) : (
            open.length > 1 && (
              <button type="button" className="ai-btn-ghost" disabled={!!bulk} onClick={() => void draftAll()}>
                {bulk === "drafting" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Draft all
              </button>
            )
          )}
        </div>
      </div>

      <div className="ai-inbox-list">
        {items.slice(0, 6).map((i) => {
          const r = rows[i.id] ?? {};
          const to = first(i.from.name, i.from.address);
          if (r.sent) {
            return (
              <div key={i.id} className="ai-mailrow is-sent">
                <span className="ai-mailrow-tx">
                  <b>Reply to {to} is on its way</b>
                  <small>{i.subject}</small>
                </span>
                <button type="button" className="ai-chip" onClick={() => void undo(i)}>
                  <Undo2 className="size-3.5" /> Undo · {r.sent.left}s
                </button>
              </div>
            );
          }
          return (
            <div key={i.id} className={clsx("ai-mailrow", i.unread && "is-unread")}>
              <div className="ai-mailrow-top">
                <span className="ai-av" aria-hidden>
                  {to[0]}
                </span>
                <Link href={`/mail/t/${i.id}`} className="ai-mailrow-tx">
                  <b>
                    {i.from.name || i.from.address}
                    <em>{ago(i.waitingSince)}</em>
                  </b>
                  <span>{i.subject}</span>
                  <small>{i.snippet}</small>
                </Link>
                <span className="ai-mailrow-side">
                  <button type="button" className="ai-chip ai-chip-ic" onClick={() => void settle(i, "later")} aria-label="Remind me tomorrow" title="Tomorrow, 9 am">
                    <Clock className="size-3.5" />
                  </button>
                  <button type="button" className="ai-chip ai-chip-ic" onClick={() => void settle(i, "done")} aria-label="Done — archive it" title="Done">
                    <Archive className="size-3.5" />
                  </button>
                </span>
              </div>

              {r.draft !== undefined ? (
                <div className="ai-mailrow-draft">
                  <textarea value={r.draft} onChange={(e) => patch(i.id, { draft: e.target.value })} rows={Math.min(10, Math.max(4, r.draft.split("\n").length + 1))} aria-label={`Reply to ${to}`} />
                  <div className="ai-mailrow-acts">
                    <button type="button" className="ai-btn" disabled={r.sending || !r.draft.trim()} onClick={() => void send(i, r.draft!)}>
                      {r.sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send
                    </button>
                    {(["friendly", "formal", "short"] as const).map((t) => (
                      <button key={t} type="button" className={clsx("ai-chip", tone === t && "is-on")} disabled={r.drafting} onClick={() => (setTone(t), void draft(i, t))}>
                        {r.drafting && tone === t ? <Loader2 className="size-3 animate-spin" /> : null}
                        {t === "friendly" ? "Warm" : t === "formal" ? "Formal" : "Shorter"}
                      </button>
                    ))}
                    <button type="button" className="ai-chip" onClick={() => patch(i.id, { draft: undefined })}>
                      Discard
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="ai-mailrow-acts">
                    <button type="button" className="ai-chip is-key" disabled={r.drafting} onClick={() => void draft(i)}>
                      {r.drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Draft reply
                    </button>
                    <button type="button" className={clsx("ai-chip", r.quick && "is-on")} onClick={() => patch(i.id, { quick: !r.quick })} aria-expanded={!!r.quick}>
                      <Zap className="size-3.5" /> Quick reply
                    </button>
                    <button type="button" className="ai-chip" onClick={() => onAsk(`Read the email “${i.subject}” from ${i.from.name || i.from.address} (thread ${i.id}), summarise it in two lines, and tell me what I should do about it.`)}>
                      Summarise
                    </button>
                  </div>
                  {r.quick && (
                    <div className="ai-mailrow-quick">
                      {QUICK.map((x) => (
                        <button key={x.label} type="button" disabled={r.sending} onClick={() => void send(i, x.body(to, myName))}>
                          <Send className="size-3" aria-hidden />
                          {x.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {r.error && <p className="ai-err">{r.error}</p>}
            </div>
          );
        })}
      </div>
      {items.length > 6 && (
        <Link href="/mail?view=needsreply" className="ai-link">
          <span>{items.length - 6} more in Mail</span>
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}
