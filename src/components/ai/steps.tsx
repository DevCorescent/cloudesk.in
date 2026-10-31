"use client";

import { Check, Loader2, X } from "lucide-react";
import type { TaskStep } from "@/lib/client/types";

export function Steps({ steps, running }: { steps: TaskStep[]; running: boolean }) {
  return (
    <ol className="grid gap-2" aria-live="polite">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2 text-[13px]">
          {s.status === "error" ? <X className="mt-0.5 size-3.5 text-danger" aria-hidden /> : <Check className="mt-0.5 size-3.5 text-success" aria-hidden />}
          <span className={s.status === "error" ? "text-danger" : "text-muted"}>
            {s.label}
            {s.detail && <span className="mt-0.5 block font-mono text-xs whitespace-pre-wrap text-subtle">{s.detail}</span>}
          </span>
        </li>
      ))}
      {running && (
        <li className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Working…
        </li>
      )}
    </ol>
  );
}
