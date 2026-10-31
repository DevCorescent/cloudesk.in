"use client";

import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUp, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { useTask } from "@/lib/client/use-task";
import { TaskReview } from "../ai/task-review";
import { useToast } from "../ui/overlays";
import { Spinner } from "../ui/primitives";

const TONES = ["warmer", "more professional", "more playful", "more luxurious", "shorter and punchier"];

/**
 * Floating AI command bar. Built-in design commands run without a provider;
 * free-form requests (copy, translation, critique) need a connected model and
 * say so. Every result is a reviewable diff.
 */
export function AiBar({ projectId, pageId, selected, flush, onApplied, canUse, blockedReason, open, setOpen, preset }: { projectId: string; pageId: string; selected: { id: string; label: string } | null; flush: () => Promise<boolean>; onApplied: () => void; canUse: boolean; blockedReason?: string; open: boolean; setOpen: (o: boolean) => void; preset: string | null }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTask(taskId);
  const input = useRef<HTMLTextAreaElement>(null);

  const [lastPreset, setLastPreset] = useState<string | null>(null);
  if (preset && preset !== lastPreset) {
    setLastPreset(preset);
    setText(preset.replace(/#\d+$/, ""));
    setTaskId(null);
  }
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  const start = useMutation({
    mutationFn: async (instruction: string) => {
      if (!(await flush())) throw new Error("Save your changes before asking the assistant.");
      // Translation requests use the dedicated task: only text is sent, and only text can change.
      const tr = /^Translate every page under \/([a-z]{2,3}(?:-[A-Z]{2})?)\b/.exec(instruction);
      if (tr) return api<{ task: { id: string } }>(`/api/v1/projects/${projectId}/ai/tasks`, { method: "POST", body: { kind: "translate", input: { lang: tr[1] } } });
      return api<{ task: { id: string } }>(`/api/v1/projects/${projectId}/ai/tasks`, { method: "POST", body: { kind: "site_edit", input: { instruction, pageId, sectionId: selected?.id } } });
    },
    onSuccess: (r) => {
      setTaskId(r.task.id);
      setText("");
    },
    onError: (e) => toast({ tone: "error", title: "Could not start", description: errorMessage(e) }),
  });
  const send = (instruction = text) => instruction.trim().length >= 3 && start.mutate(instruction.trim());

  const scope = selected ? `this ${selected.label.toLowerCase()} section` : "this page";
  const suggestions = selected
    ? [`Make ${scope} feel more premium`, "Try a bolder layout for this section", `Rewrite the copy in ${scope} to be ${TONES[0]}`]
    : ["Make it more premium", "Switch to dark mode", "Improve spacing", "Try a different font pairing", "Fix contrast"];

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="group absolute bottom-20 left-1/2 z-20 flex h-11 max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2 truncate glass-strong rounded-full pr-5 pl-4 text-[13px] whitespace-nowrap text-muted hover:text-fg md:bottom-5">
        <Sparkles className="size-4 text-accent" aria-hidden />
        Ask AI to change anything{selected ? ` in ${selected.label}` : ""}…
        <kbd className="ml-1 hidden rounded border border-border px-1 text-[11px] sm:inline">/</kbd>
      </button>
    );
  }
  return (
    <div role="dialog" aria-label="AI assistant" className="animate-in absolute bottom-20 left-1/2 z-30 flex md:bottom-5 max-h-[min(70%,560px)] w-[min(600px,calc(100%-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[22px] glass-strong">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <Sparkles className="size-4 text-accent" aria-hidden /> AI assistant
          {selected && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">{selected.label}</span>}
        </span>
        <button aria-label="Close assistant" onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {task.data ? (
          <TaskReview task={task.data} beforeApply={flush} onApplied={onApplied} onRetried={setTaskId} />
        ) : taskId ? (
          <Spinner />
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} disabled={!canUse} onClick={() => send(s)} className="rounded-full border border-border px-3 py-1 text-xs hover:border-border-strong hover:bg-surface-2 disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">Copy tone · needs an AI model</p>
              <div className="flex flex-wrap gap-1.5">
                {TONES.map((t) => (
                  <button key={t} disabled={!canUse} onClick={() => send(`Rewrite the copy on ${scope} to sound ${t}. Keep facts, names, prices and placeholders unchanged.`)} className="rounded-full bg-surface-2 px-3 py-1 text-xs hover:bg-surface-3 disabled:opacity-50">
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-subtle">Design commands such as “make it more premium” work without an AI provider. Copywriting, translation and critique need Claude connected in Settings → AI providers.</p>
          </div>
        )}
      </div>
      <form className="border-t border-border p-2.5" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className={clsx("flex items-end gap-2 rounded-[14px] border border-border bg-surface-solid px-3 py-2 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15")}>
          <textarea
            ref={input}
            value={text}
            disabled={!canUse}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            rows={1}
            maxLength={2000}
            aria-label="Ask the assistant"
            placeholder={canUse ? `Describe a change to ${scope}…` : (blockedReason ?? "Your role cannot use the assistant")}
            className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
          <button type="submit" aria-label="Send" disabled={!canUse || text.trim().length < 3 || start.isPending} className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fg text-bg disabled:opacity-30">
            <ArrowUp className="size-4" />
          </button>
        </div>
        {taskId && (
          <button type="button" className="mt-1.5 px-1 text-xs text-muted hover:text-fg" onClick={() => setTaskId(null)}>
            ← New request
          </button>
        )}
      </form>
    </div>
  );
}
