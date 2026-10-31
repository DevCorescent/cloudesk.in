"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bot, RotateCcw, User } from "lucide-react";
import { useState } from "react";
import { DiffView } from "./ai/diff-view";
import { Dialog, useToast } from "./ui/overlays";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "./ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";

type Rev = { revision: number; source: string; message: string | null; createdAt: string; authorName: string | null; deleted: boolean };

/** Version history for one file, with a diff against the current version and restore. */
export function HistoryDialog({ open, onClose, projectId, path, currentRevision, currentContent, onRestored, canRestore }: { open: boolean; onClose: () => void; projectId: string; path: string; currentRevision: number; currentContent: string; onRestored: () => void; canRestore: boolean }) {
  const toast = useToast();
  const [selected, setSelected] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["history", projectId, path, currentRevision], queryFn: () => api<{ revisions: Rev[] }>(`/api/v1/projects/${projectId}/file/history?path=${encodeURIComponent(path)}`), enabled: open });
  const rev = useQuery({
    queryKey: ["revision", projectId, path, selected],
    queryFn: () => api<{ content: string }>(`/api/v1/projects/${projectId}/file/revision?path=${encodeURIComponent(path)}&revision=${selected}`),
    enabled: open && selected !== null,
  });
  const restore = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/file/restore`, { method: "POST", body: { path, revision: selected, baseRevision: currentRevision } }),
    onSuccess: () => {
      toast({ tone: "success", title: `Restored revision ${selected}`, description: "Saved as a new version; nothing was lost." });
      setSelected(null);
      onRestored();
      onClose();
    },
    onError: (e) => toast({ tone: "error", title: "Could not restore", description: errorMessage(e) }),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Version history" description={<span className="font-mono">{path}</span>} size="xl">
      <div className="grid min-h-[50vh] gap-4 md:grid-cols-[260px_1fr]">
        <div className="max-h-[60vh] overflow-y-auto">
          {list.isPending ? (
            <Skeleton className="h-40" />
          ) : list.isError ? (
            <ErrorState message={errorMessage(list.error)} />
          ) : (
            <ul className="grid gap-0.5">
              {list.data.revisions.map((r) => (
                <li key={r.revision}>
                  <button
                    disabled={r.deleted}
                    onClick={() => setSelected(r.revision)}
                    aria-current={selected === r.revision}
                    className={clsx("flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] disabled:opacity-50", selected === r.revision ? "bg-surface-3" : "hover:bg-surface-2")}
                  >
                    <span className="mt-0.5 text-muted">{r.source === "ai" ? <Bot className="size-3.5" /> : <User className="size-3.5" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        r{r.revision} {r.revision === currentRevision && <Badge tone="accent">Current</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted">{r.message || r.source}</span>
                      <span className="block text-[11px] text-subtle" title={dateTime(r.createdAt)}>
                        {r.authorName ?? "—"} · {timeAgo(r.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          {selected === null ? (
            <EmptyState title="Select a version" description="Compare it with the current version and restore it if needed." />
          ) : rev.isPending ? (
            <Skeleton className="h-60" />
          ) : rev.isError ? (
            <ErrorState message={errorMessage(rev.error)} />
          ) : (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-muted">
                  Changes from r{selected} to the current version (r{currentRevision})
                </p>
                {canRestore && selected !== currentRevision && (
                  <Button size="sm" icon={<RotateCcw className="size-3.5" />} loading={restore.isPending} onClick={() => restore.mutate()}>
                    Restore r{selected}
                  </Button>
                )}
              </div>
              <DiffView className="max-h-[55vh]" before={rev.data.content} after={currentContent} />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
