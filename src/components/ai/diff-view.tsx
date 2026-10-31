"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { hunks, lineDiff } from "@/lib/diff";

export function DiffView({ before, after, className }: { before: string; after: string; className?: string }) {
  const parts = useMemo(() => hunks(lineDiff(before, after), 3), [before, after]);
  return (
    <div className={clsx("overflow-auto rounded-[var(--radius-md)] border border-border bg-surface font-mono text-[12px] leading-[1.55]", className)}>
      {parts.map((h, i) =>
        "skipped" in h ? (
          <div key={i} className="bg-surface-2 px-3 py-0.5 text-[11px] text-subtle">
            ⋯ {h.skipped} unchanged line{h.skipped === 1 ? "" : "s"}
          </div>
        ) : (
          h.lines.map((l, j) => (
            <div key={`${i}-${j}`} className={clsx("flex whitespace-pre", l.type === "add" && "bg-success-soft", l.type === "del" && "bg-danger-soft")}>
              <span className="w-9 shrink-0 pr-2 text-right text-subtle select-none">{l.type === "add" ? "" : l.a}</span>
              <span className="w-9 shrink-0 pr-2 text-right text-subtle select-none">{l.type === "del" ? "" : l.b}</span>
              <span className={clsx("w-4 shrink-0 select-none", l.type === "add" ? "text-success" : l.type === "del" ? "text-danger" : "text-subtle")}>{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
              <span className="pr-3">{l.text}</span>
            </div>
          ))
        ),
      )}
    </div>
  );
}
