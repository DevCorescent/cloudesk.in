"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, FileMinus, FilePlus, FileText, RotateCcw, Square, X } from "lucide-react";
import { useState } from "react";
import { Steps } from "./steps";
import { Badge, Button, Notice } from "../ui/primitives";
import { useToast } from "../ui/overlays";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { usd } from "@/lib/client/format";
import type { AiTask } from "@/lib/client/types";
import { isActive } from "@/lib/client/use-task";
import { diffStats, lineDiff } from "@/lib/diff";
import { DiffView } from "./diff-view";

/**
 * Shows a task's progress and, once it proposes changes, a reviewable diff.
 * Nothing is written to the project until the user accepts.
 */
export function TaskReview({ task, onApplied, onRetried, beforeApply }: { task: AiTask; onApplied: () => void; onRetried: (taskId: string) => void; beforeApply?: () => Promise<boolean> }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["task", task.id] });

  const apply = useMutation({
    mutationFn: async () => {
      if (beforeApply && !(await beforeApply())) throw new Error("Save your changes first");
      return api(`/api/v1/ai/tasks/${task.id}/apply`, { method: "POST" });
    },
    onSuccess: () => {
      refresh();
      onApplied();
      toast({ tone: "success", title: "Changes applied", description: "Recorded in version history; you can restore the previous version." });
    },
    onError: (e) =>
      toast({
        tone: "error",
        title: e instanceof ApiClientError && e.code === "revision_conflict" ? "The file changed after the AI read it" : "Could not apply",
        description: e instanceof ApiClientError && e.code === "revision_conflict" ? "Nothing was applied. Ask again so the AI works from the latest version." : errorMessage(e),
      }),
  });
  const reject = useMutation({ mutationFn: () => api(`/api/v1/ai/tasks/${task.id}/reject`, { method: "POST" }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => api(`/api/v1/ai/tasks/${task.id}/cancel`, { method: "POST" }), onSuccess: refresh, onError: (e) => toast({ tone: "error", title: "Could not cancel", description: errorMessage(e) }) });
  const retry = useMutation({
    mutationFn: () => api<{ task: { id: string } }>(`/api/v1/ai/tasks/${task.id}/retry`, { method: "POST" }),
    onSuccess: (r) => onRetried(r.task.id),
    onError: (e) => toast({ tone: "error", title: "Could not retry", description: errorMessage(e) }),
  });

  const running = isActive(task.status);
  const result = task.result?.type === "changes" ? task.result : null;
  const instruction = (task.input as { instruction?: string }).instruction;

  return (
    <div className="grid gap-3">
      {instruction && <p className="rounded-[var(--radius-md)] bg-surface-2 px-3 py-2 text-[13px]">{instruction}</p>}
      <Steps steps={task.steps} running={running} />
      {running && (
        <Button size="sm" className="justify-self-start" icon={<Square className="size-3" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>
          Stop
        </Button>
      )}
      {(task.status === "failed" || (task.status === "cancelled" && task.errorCode !== "rejected")) && (
        <Notice
          tone={task.status === "failed" ? "danger" : "neutral"}
          title={task.status === "failed" ? "The task failed" : "Cancelled"}
          action={task.attempt < 5 && <Button size="sm" icon={<RotateCcw className="size-3.5" />} loading={retry.isPending} onClick={() => retry.mutate()}>Retry</Button>}
        >
          {task.status === "failed" ? task.error : null}
        </Notice>
      )}
      {result && (
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {result.planner === "builtin" ? <Badge>Built-in command</Badge> : <Badge tone="accent">{task.model}</Badge>}
            {task.costMicroUsd > 0 && <span className="text-xs text-subtle">{usd(task.costMicroUsd)} · {(task.inputTokens + task.outputTokens).toLocaleString()} tokens</span>}
          </div>
          <p className="text-[13px]">{result.summary}</p>
          {result.changes.length === 0 && <Notice>No file changes were proposed.</Notice>}
          <ul className="grid gap-1.5">
            {result.changes.map((c) => {
              const stats = diffStats(lineDiff(c.before ?? "", c.after ?? ""));
              const Icon = c.action === "create" ? FilePlus : c.action === "delete" ? FileMinus : FileText;
              return (
                <li key={c.path}>
                  <button onClick={() => setOpen(open === c.path ? null : c.path)} aria-expanded={open === c.path} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[13px] hover:bg-surface-2">
                    <Icon className="size-3.5 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{c.path}</span>
                    <span className="text-xs text-success tabular-nums">+{stats.added}</span>
                    <span className="text-xs text-danger tabular-nums">−{stats.removed}</span>
                  </button>
                  {open === c.path && <DiffView className="mt-1 max-h-80" before={c.before ?? ""} after={c.after ?? ""} />}
                </li>
              );
            })}
          </ul>
          {task.status === "awaiting_review" && result.changes.length > 0 && (
            <div className="flex gap-2">
              <Button variant="primary" size="sm" icon={<Check className="size-3.5" />} loading={apply.isPending} onClick={() => apply.mutate()}>
                Accept changes
              </Button>
              <Button size="sm" icon={<X className="size-3.5" />} loading={reject.isPending} onClick={() => reject.mutate()}>
                Reject
              </Button>
            </div>
          )}
          {result.decision === "applied" && <Notice tone="success">Applied.</Notice>}
          {result.decision === "rejected" && <Notice>Rejected. No changes were made.</Notice>}
        </div>
      )}
    </div>
  );
}
