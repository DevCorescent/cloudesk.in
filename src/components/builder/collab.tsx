"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, MessageSquare, RotateCcw, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, useToast } from "../ui/overlays";
import { Badge, Button, cx, Field, IconButton, Input, Textarea } from "../ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { sectionDef, type Page, type SiteDoc } from "@/lib/site/model";

// ─── Presence ────────────────────────────────────────────────────────────────

export type Peer = { userId: string; name: string; email: string; pageId: string; sectionId: string };

const COLORS = ["#e8590c", "#2b8a3e", "#5f3dc4", "#1971c2", "#c2255c", "#0c8599", "#e67700"];
export const peerColor = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = (name: string, email: string) => (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Heartbeat every 15 s; returns teammates seen in the last 45 s. */
export function usePresence(projectId: string, pageId: string, sectionId: string | null, enabled: boolean) {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const beat = () =>
      api<{ others: Peer[] }>(`/api/v1/projects/${projectId}/collab/presence`, { method: "POST", body: { pageId, sectionId: sectionId ?? "" } })
        .then((r) => alive && setPeers(r.others))
        .catch(() => {});
    void beat();
    const t = setInterval(beat, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [projectId, pageId, sectionId, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const bye = () => void fetch(`/api/v1/projects/${projectId}/collab/presence`, { method: "DELETE", keepalive: true, credentials: "same-origin" }).catch(() => {});
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [projectId, enabled]);
  return peers;
}

export function PresenceAvatars({ peers, doc }: { peers: Peer[]; doc: SiteDoc }) {
  if (!peers.length) return null;
  return (
    <div className="mr-1 hidden items-center -space-x-1.5 md:flex" aria-label={`${peers.length} other ${peers.length === 1 ? "person is" : "people are"} editing`}>
      {peers.slice(0, 4).map((p) => {
        const page = doc.pages.find((x) => x.id === p.pageId);
        return (
          <span key={p.userId} title={`${p.name || p.email}${page ? ` — on ${page.title}` : ""}`} className="flex size-7 items-center justify-center rounded-full border-2 border-surface text-[11px] font-semibold text-white" style={{ background: peerColor(p.userId) }}>
            {initials(p.name, p.email)}
          </span>
        );
      })}
      {peers.length > 4 && <span className="flex size-7 items-center justify-center rounded-full border-2 border-surface bg-surface-3 text-[11px]">+{peers.length - 4}</span>}
    </div>
  );
}

// ─── Comments ────────────────────────────────────────────────────────────────

type Comment = { id: string; pageId: string; sectionId: string; parentId: string | null; body: string; authorId: string | null; authorName: string | null; guestName: string | null; fromReview: string | null; resolvedAt: string | null; createdAt: string };

export function useComments(projectId: string) {
  return useQuery({ queryKey: ["comments", projectId], queryFn: () => api<{ comments: Comment[] }>(`/api/v1/projects/${projectId}/collab/comments`), refetchInterval: 20_000 });
}

export function CommentsPanel({ projectId, doc, page, selectedId, canResolve, meId, onSelect }: { projectId: string; doc: SiteDoc; page: Page; selectedId: string | null; canResolve: boolean; meId: string; onSelect: (id: string | null) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useComments(projectId);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const base = `/api/v1/projects/${projectId}/collab/comments`;
  const refresh = () => qc.invalidateQueries({ queryKey: ["comments", projectId] });
  const add = useMutation({
    mutationFn: (v: { body: string; sectionId: string; parentId?: string }) => api(base, { method: "POST", body: { pageId: page.id, ...v } }),
    onSuccess: (_r, v) => {
      if (v.parentId) setReply({ ...reply, [v.parentId]: "" });
      else setText("");
      refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Could not comment", description: errorMessage(e) }),
  });
  const resolve = useMutation({ mutationFn: (v: { id: string; resolved: boolean }) => api(`${base}/${v.id}/resolve`, { method: "POST", body: { resolved: v.resolved } }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`${base}/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const all = (q.data?.comments ?? []).filter((c) => c.pageId === page.id);
  const threads = all.filter((c) => !c.parentId && (showResolved || !c.resolvedAt));
  const label = (sectionId: string) => {
    const s = page.sections.find((x) => x.id === sectionId);
    return s ? (sectionDef(s.type)?.label ?? s.type) : sectionId ? "Removed section" : "Whole page";
  };
  const selectedLabel = selectedId ? label(selectedId) : null;
  const who = (c: Comment) => c.authorName ?? (c.guestName ? `${c.guestName} (client)` : "Someone");
  void doc;

  return (
    <div className="grid gap-3 p-3">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate({ body: text, sectionId: selectedId ?? "" });
        }}
      >
        <Textarea aria-label="New comment" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={selectedLabel ? `Comment on ${selectedLabel}… use @name to mention` : "Comment on this page… select a section to pin it"} maxLength={4000} />
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted">{selectedLabel ? `On: ${selectedLabel}` : "On: whole page"}</span>
          <Button type="submit" size="sm" variant="primary" icon={<Send className="size-3.5" />} loading={add.isPending && !add.variables?.parentId} disabled={!text.trim()}>
            Comment
          </Button>
        </div>
      </form>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
      </label>
      {threads.length === 0 && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <MessageSquare className="size-4" /> No open comments on this page.
        </p>
      )}
      {threads.map((c) => {
        const replies = all.filter((r) => r.parentId === c.id);
        return (
          <div key={c.id} className={cx("rounded-[var(--radius-md)] border border-border p-2.5 text-[13px]", c.resolvedAt && "opacity-60", c.sectionId && c.sectionId === selectedId && "border-accent")}>
            <button type="button" className="mb-1 flex w-full items-center justify-between gap-2 text-left text-xs text-muted hover:text-fg" onClick={() => onSelect(c.sectionId || null)}>
              <span className="truncate">{label(c.sectionId)}</span>
              {c.fromReview && <Badge tone="accent">Client</Badge>}
            </button>
            {[c, ...replies].map((m) => (
              <div key={m.id} className="mt-1.5 first:mt-0">
                <p className="text-xs">
                  <span className="font-medium">{who(m)}</span> <span className="text-subtle">{timeAgo(m.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
            {!c.resolvedAt && (
              <form
                className="mt-2 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reply[c.id]?.trim()) add.mutate({ body: reply[c.id], sectionId: c.sectionId, parentId: c.id });
                }}
              >
                <Input aria-label="Reply" value={reply[c.id] ?? ""} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })} placeholder="Reply…" className="h-7" />
              </form>
            )}
            <div className="mt-1.5 flex justify-end gap-1">
              {canResolve && (
                <Button size="sm" variant="ghost" icon={c.resolvedAt ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />} onClick={() => resolve.mutate({ id: c.id, resolved: !c.resolvedAt })}>
                  {c.resolvedAt ? "Reopen" : "Resolve"}
                </Button>
              )}
              {(c.authorId === meId || canResolve) && <IconButton size="sm" label="Delete comment" icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(c.id)} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Share for review ────────────────────────────────────────────────────────

type ReviewLink = { id: string; label: string; status: string; decidedBy: string | null; decisionNote: string | null; expiresAt: string; revokedAt: string | null; createdAt: string };

export function ShareDialog({ projectId, open, onClose, canShare }: { projectId: string; open: boolean; onClose: () => void; canShare: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["review-links", projectId], queryFn: () => api<{ links: ReviewLink[] }>(`/api/v1/projects/${projectId}/collab/review-links`), enabled: open });
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(14);
  const [made, setMade] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ url: string }>(`/api/v1/projects/${projectId}/collab/review-links`, { method: "POST", body: { label, days } }),
    onSuccess: (r) => {
      setMade(r.url);
      setLabel("");
      qc.invalidateQueries({ queryKey: ["review-links", projectId] });
    },
    onError: (e) => toast({ tone: "error", title: "Could not create the link", description: errorMessage(e) }),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/collab/review-links/${id}/revoke`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["review-links", projectId] }) });
  const copy = (u: string) => navigator.clipboard.writeText(u).then(() => toast({ tone: "success", title: "Link copied" }));
  return (
    <Dialog open={open} onClose={onClose} title="Share for review" description="Clients open the link without an account, see your latest deployed version, leave comments and approve or request changes. The link shows the most recent deployment at the time you create it.">
      <div className="space-y-4">
        {canShare ? (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Label (optional)">{(a) => <Input {...a} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Homepage round 2" maxLength={80} />}</Field>
            <Field label="Valid for (days)">{(a) => <Input {...a} type="number" min={1} max={60} value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 14)))} />}</Field>
            <Button type="submit" variant="primary" icon={<Link2 className="size-3.5" />} loading={create.isPending}>
              Create link
            </Button>
          </form>
        ) : (
          <p className="text-[13px] text-muted">You need permission to deploy previews to share for review.</p>
        )}
        {made && (
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-success-soft p-2.5">
            <Input readOnly value={made} className="font-mono text-xs" aria-label="Review link" onFocus={(e) => e.target.select()} />
            <IconButton label="Copy link" icon={<Copy className="size-3.5" />} onClick={() => copy(made)} />
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Links</p>
          {(q.data?.links ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">No review links yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border text-[13px]">
              {q.data!.links.map((l) => {
                const dead = !!l.revokedAt || new Date(l.expiresAt).getTime() < (q.dataUpdatedAt || 0);
                return (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{l.label || "Review link"}</span>{" "}
                      {l.status === "approved" ? <Badge tone="success">Approved by {l.decidedBy}</Badge> : l.status === "changes_requested" ? <Badge tone="warning">Changes requested by {l.decidedBy}</Badge> : <Badge>Waiting</Badge>}
                      {dead && <Badge>{l.revokedAt ? "Turned off" : "Expired"}</Badge>}
                      {l.decisionNote && <span className="block text-xs text-muted">“{l.decisionNote}”</span>}
                    </span>
                    {!dead && canShare && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(l.id)}>
                        Turn off
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
