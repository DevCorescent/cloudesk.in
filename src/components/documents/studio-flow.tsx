"use client";

// The document studio inside a conversation (AI mode): the same steps as
// /documents/studio — the kind, the details, the draft, the finished document
// with its preview, checks, downloads, sharing and revisions — in one card in
// the chat, so drafting never leaves it. A card from an earlier conversation
// waits for a tap rather than starting again on its own.
import { FileText, Loader2, RotateCcw, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { kindById } from "@/lib/documents/studio";
import { Ask, Done, Library, type Made, type Plan } from "./studio";

type Phase = { at: "idle" } | { at: "planning" } | { at: "pick" } | { at: "ask"; plan: Plan; drafting: boolean } | { at: "done"; plan: Plan; made: Made } | { at: "error"; message: string };
const STEPS = ["Type", "Details", "Draft", "Ready"];

export function DocFlow({ orgId, prompt = "", kindId, autoStart = true, onDone }: { orgId: string; prompt?: string; kindId?: string; autoStart?: boolean; onDone?: (made: Made) => void }) {
  const base = `/api/v1/orgs/${orgId}/documents`;
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [busy, setBusy] = useState<string | null>(null);

  const start = async (kind?: string) => {
    if (!prompt.trim() && !kind) return setPhase({ at: "pick" });
    setPhase({ at: "planning" });
    setBusy(kind ?? "prompt");
    try {
      const plan = await api<Plan>(`${base}/studio/plan`, { method: "POST", body: { prompt: prompt.trim(), ...(kind ? { kindId: kind } : {}) } });
      setPhase({ at: "ask", plan, drafting: false });
    } catch (e) {
      setPhase({ at: "error", message: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  // Starts straight away in a live conversation (just after it appears).
  useEffect(() => {
    if (!autoStart) return;
    const t = setTimeout(() => void start(kindId && kindById(kindId) ? kindId : undefined), 0);
    return () => clearTimeout(t);
    // Once, when the card first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = phase.at === "pick" || phase.at === "planning" || phase.at === "idle" || phase.at === "error" ? 0 : phase.at === "ask" ? (phase.drafting ? 2 : 1) : 3;
  return (
    <div className="ai-docflow mt-3 grid min-w-0 gap-3 rounded-[20px] border border-border bg-[var(--surface-solid)] p-3 text-fg sm:p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-fg text-bg"><FileText className="size-3.5" /></span>
        <ol className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto text-[11.5px] [scrollbar-width:none]" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className={cx("flex shrink-0 items-center gap-1.5", i === step ? "font-semibold text-fg" : i < step ? "text-muted" : "text-subtle")} aria-current={i === step ? "step" : undefined}>
              {i > 0 && <span className={cx("h-px w-3 sm:w-5", i <= step ? "bg-fg/40" : "bg-border")} aria-hidden />}
              {s}
            </li>
          ))}
        </ol>
      </div>

      {phase.at === "idle" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-fg/[0.03] px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{prompt || "A business document"}</span>
          <Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} onClick={() => void start(kindId)}>Draft it</Button>
        </div>
      ) : phase.at === "planning" ? (
        <p className="flex items-center gap-2 px-1 py-3 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> Working out the document and what it needs…</p>
      ) : phase.at === "pick" ? (
        <Library compact busy={busy} onPick={(id) => void start(id)} />
      ) : phase.at === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
          <span className="min-w-0 flex-1">{phase.message}</span>
          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => void start(kindId)}>Try again</Button>
        </div>
      ) : phase.at === "ask" ? (
        <Ask
          compact
          plan={phase.plan}
          prompt={prompt}
          base={base}
          backLabel="Choose another document"
          onBack={() => setPhase({ at: "pick" })}
          onMaking={() => setPhase({ ...phase, drafting: true })}
          onFailed={() => setPhase({ ...phase, drafting: false })}
          onMade={(made) => {
            setPhase({ at: "done", plan: phase.plan, made });
            onDone?.(made);
          }}
        />
      ) : (
        <Done compact made={phase.made} base={base} />
      )}
    </div>
  );
}
