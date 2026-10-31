"use client";

// The bell in the top bar: unread count, the latest notifications, and a way
// into the inbox. Polls once a minute; opening an item marks it read.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";

export type Notification = { id: string; kind: string; title: string; body: string; link: string; readAt: string | null; createdAt: string; email: "recorded" | "sent" | "queued" | "retrying" | "failed" | null };
export type NotificationList = { unread: number; items: Notification[] };

export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export function useNotifications(limit = 12) {
  const { org } = useSession();
  return useQuery({ queryKey: ["notify", org.id, limit], queryFn: () => api<NotificationList>(`/api/v1/orgs/${org.id}/notifications?limit=${limit}`), refetchInterval: 60_000 });
}

export function useMarkRead() {
  const { org } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[] | "all") => api(`/api/v1/orgs/${org.id}/notifications/read`, { method: "POST", body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notify", org.id] }),
  });
}

export function NotificationBell() {
  const q = useNotifications();
  const read = useMarkRead();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", off), document.removeEventListener("keydown", esc));
  }, [open]);
  const unread = q.data?.unread ?? 0;
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Notifications" className="bar-icon">
        <Bell aria-hidden />
        {unread > 0 && <span className="bar-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="glass-strong animate-in absolute top-full right-0 z-50 mt-1.5 w-[min(380px,calc(100vw-24px))] rounded-[16px] p-1.5">
          <div className="flex items-center justify-between px-2.5 py-2">
            <p className="text-[13px] font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => read.mutate("all")} className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {!q.data?.items.length && <li className="px-3 py-8 text-center text-[13px] text-muted">Nothing yet. Approvals, tasks and reminders show up here.</li>}
            {q.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!n.readAt) read.mutate([n.id]);
                    setOpen(false);
                    if (n.link) router.push(n.link);
                  }}
                  className={cx("flex w-full gap-2.5 rounded-[10px] px-2.5 py-2 text-left hover:bg-surface-2", !n.readAt && "bg-accent-soft/30")}
                >
                  <span aria-hidden className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-snug font-medium">{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-subtle">{ago(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/inbox" onClick={() => setOpen(false)} className="mt-1 flex items-center justify-center gap-1.5 rounded-[10px] border-t border-border px-3 py-2.5 text-[13px] font-medium hover:bg-surface-2">
            <Inbox className="size-3.5" /> Open my work
          </Link>
        </div>
      )}
    </div>
  );
}
