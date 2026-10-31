"use client";

// Sender clean-up: everyone who has written to you, most mail first, with one
// action for all of their mail — archive, mark read, unsubscribe (and archive),
// trash or block. Trash and block ask first.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, Ban, Crown, MailCheck, MailMinus, Search, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, EmptyState, ErrorState, IconButton, Select, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { CleanupIn, MetaOut, SenderRow, SendersOut } from "@/lib/mail/api";
import { Avatar, mailKey, shortTime, useMailApi, useMailRefresh } from "./shared";

export function SenderCleanup({ meta }: { meta: MetaOut }) {
  const { orgId, call } = useMailApi();
  const qc = useQueryClient();
  const refresh = useMailRefresh();
  const toast = useToast();
  const [account, setAccount] = useState("all");
  const [text, setText] = useState("");
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: SenderRow; action: "trash" | "block" } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setFind(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const key = mailKey(orgId, "senders", account, find);
  const q = useQuery({ queryKey: key, queryFn: () => call<SendersOut>(`senders/top?account=${account}&q=${encodeURIComponent(find)}`) });

  const run = async (row: SenderRow, action: CleanupIn["action"]) => {
    setBusy(`${row.address}:${action}`);
    try {
      const r = await call<{ count: number; unsubscribed?: boolean }>("senders/cleanup", "POST", { address: row.address, account, action } satisfies CleanupIn);
      const who = row.name || row.address;
      const title = action === "archive" ? `Archived ${r.count} from ${who}` : action === "read" ? `Marked ${who}'s mail read` : action === "unsubscribe" ? `Unsubscribed from ${who}` : action === "block" ? `Blocked ${who}` : `Moved ${r.count} from ${who} to trash`;
      toast({ tone: "success", title, description: action === "block" ? "Their future mail goes to spam." : undefined });
      void qc.invalidateQueries({ queryKey: mailKey(orgId, "senders") });
      void refresh();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const rows = q.data?.senders ?? [];
  const lists = rows.filter((r) => r.list && r.inInbox > 0);

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 py-6 sm:px-8">
      <Link href="/mail" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Back to mail</Link>
      <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.025em]">Clean up senders</h1>
      <p className="mt-0.5 max-w-2xl text-[13px] text-muted">Everyone who has written to you, most mail first. One click handles all of a sender&apos;s mail — here and in your real mailbox.</p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <input aria-label="Find a sender" value={text} onChange={(e) => setText(e.target.value)} placeholder="Find a sender or domain" className="h-9 w-full rounded-[11px] border border-border bg-[var(--surface-solid)] pr-3 pl-9 text-[13.5px] outline-none focus:border-sky-500/50" style={{ outline: "none" }} />
        </div>
        {meta.accounts.length > 1 && (
          <Select aria-label="Mailbox" value={account} onChange={(e) => setAccount(e.target.value)} className="!h-9 !w-auto">
            <option value="all">All mailboxes</option>
            {meta.accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        )}
      </div>

      {lists.length > 1 && !find && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[16px] border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3 text-[13px]">
          <Sparkles className="size-4 shrink-0 text-sky-600" />
          <span className="flex-1"><b className="font-semibold">{lists.length} mailing lists</b> have {lists.reduce((s, r) => s + r.inInbox, 0)} conversations in your inbox. Unsubscribe from the ones you don&apos;t read.</span>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-[20px] border border-border bg-surface">
        {q.isError ? (
          <div className="p-6"><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>
        ) : !q.data ? (
          <div className="grid gap-2 p-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-[12px]" />)}</div>
        ) : !rows.length ? (
          <EmptyState className="py-14" icon={<MailCheck className="size-6" />} title={find ? "No sender matches" : "Nothing to clean up"} description={find ? "Try part of the address or the domain." : "Mail you receive shows up here, grouped by sender."} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const b = (a: string) => busy === `${r.address}:${a}`;
              return (
                <li key={r.address} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="flex min-w-0 flex-1 basis-[260px] items-center gap-3">
                    <Avatar p={{ name: r.name, address: r.address }} size={36} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                        <span className="truncate">{r.name || r.address}</span>
                        {r.list && <Badge>List</Badge>}
                        {r.verdict === "vip" && <Badge tone="warning"><Crown className="size-3" />VIP</Badge>}
                        {r.verdict === "blocked" && <Badge tone="danger">Blocked</Badge>}
                      </p>
                      <p className="truncate text-[12px] text-muted">{r.name ? `${r.address} · ` : ""}last {shortTime(r.last)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-muted tabular-nums">
                    <span><b className="text-[14px] font-semibold text-fg">{r.messages}</b> emails</span>
                    <span className={cx(r.unread > 0 && "text-sky-700 dark:text-sky-400")}><b className="font-semibold">{r.unread}</b> unread</span>
                    <span><b className="font-semibold text-fg">{r.inInbox}</b> in inbox</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" icon={<Archive className="size-3.5" />} disabled={!r.inInbox} loading={b("archive")} onClick={() => void run(r, "archive")}>Archive all</Button>
                    {r.list && <Button size="sm" icon={<MailMinus className="size-3.5" />} loading={b("unsubscribe")} onClick={() => void run(r, "unsubscribe")}>Unsubscribe</Button>}
                    <IconButton label="Mark all read" icon={<MailCheck className="size-4" />} disabled={!r.unread} onClick={() => void run(r, "read")} />
                    <IconButton label="Move all to trash" icon={<Trash2 className="size-4" />} onClick={() => setConfirm({ row: r, action: "trash" })} />
                    {r.verdict !== "blocked" && <IconButton label="Block sender" icon={<Ban className="size-4" />} onClick={() => setConfirm({ row: r, action: "block" })} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirm && (
        <ConfirmDialog
          open
          destructive
          onClose={() => setConfirm(null)}
          onConfirm={() => { void run(confirm.row, confirm.action); setConfirm(null); }}
          title={confirm.action === "block" ? `Block ${confirm.row.name || confirm.row.address}?` : `Trash all mail from ${confirm.row.name || confirm.row.address}?`}
          description={confirm.action === "block" ? `Their ${confirm.row.messages} emails move to trash, and anything new from ${confirm.row.address} goes to spam. You can unblock them from any of their emails.` : `${confirm.row.messages} emails move to trash, here and in your mailbox. You can bring them back from Trash.`}
          confirmLabel={confirm.action === "block" ? "Block and trash" : "Move to trash"}
        />
      )}
    </div>
  );
}
