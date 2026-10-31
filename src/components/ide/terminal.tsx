"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";

type Line = { stream: "out" | "err" | "info" | "cmd"; text: string };
type Result = { exitCode: number; output: { stream: "out" | "err" | "info"; text: string }[]; changed: string[]; durationMs: number; runtime: string };
type History = { runs: { command: string }[]; docker: boolean; limits: { timeMs: number; memoryBytes: number } };

export type TerminalHandle = { run: (command: string) => void };

/** The IDE terminal: commands run on the server in the project's sandbox. */
export const Terminal = forwardRef<TerminalHandle, { projectId: string; onChanged: (paths: string[]) => void }>(function Terminal({ projectId, onChanged }, ref) {
  const meta = useQuery({ queryKey: ["terminal", projectId], queryFn: () => api<History>(`/api/v1/projects/${projectId}/terminal`), staleTime: Infinity });
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [session, setSession] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Newest first: this session's commands, then earlier ones from the server.
  const history = [...session, ...(meta.data?.runs.map((r) => r.command) ?? [])].filter((c, i, a) => a.indexOf(c) === i);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines]);

  async function run(command: string) {
    const c = command.trim();
    setInput("");
    setCursor(null);
    if (!c) return;
    setSession((s) => [c, ...s.filter((x) => x !== c)].slice(0, 100));
    if (c === "clear") return setLines([]);
    if (c === "history") return setLines((l) => [...l, { stream: "cmd", text: c }, ...history.slice(0, 30).reverse().map((h, i) => ({ stream: "out" as const, text: `${String(i + 1).padStart(4)}  ${h}` }))]);
    setLines((l) => [...l, { stream: "cmd", text: c }]);
    setBusy(true);
    try {
      const r = await api<Result>(`/api/v1/projects/${projectId}/terminal`, { method: "POST", body: { command: c } });
      setLines((l) => [...l, ...r.output, ...(r.exitCode !== 0 && r.runtime !== "builtin" ? [{ stream: "info" as const, text: `exit ${r.exitCode} · ${r.durationMs} ms` }] : r.runtime !== "builtin" ? [{ stream: "info" as const, text: `done in ${r.durationMs} ms` }] : [])].slice(-2000));
      if (r.changed.length) onChanged(r.changed);
    } catch (e) {
      setLines((l) => [...l, { stream: "err", text: errorMessage(e) }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => field.current?.focus());
    }
  }
  useImperativeHandle(ref, () => ({ run: (c) => void run(c) }));

  return (
    <div className="flex h-full flex-col bg-[#0b0b0c] font-mono text-[12px] leading-[1.55] text-[#e5e5ea]" onClick={() => field.current?.focus()}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" role="log" aria-live="polite">
        {lines.length === 0 && (
          <p className="text-[#8e8e93]">
            Sandboxed JavaScript runtime (QuickJS · WebAssembly){meta.data ? ` · ${meta.data.limits.timeMs / 1000} s · ${meta.data.limits.memoryBytes / 1024 / 1024} MB · no network` : ""}
            {meta.data?.docker ? " · containers on" : ""}. Type <span className="text-white">help</span> to see commands.
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={clsx("break-words whitespace-pre-wrap", l.stream === "err" && "text-[#ff8a80]", l.stream === "info" && "text-[#8e8e93]", l.stream === "cmd" && "mt-1 text-white")}>
            {l.stream === "cmd" && <span className="text-[#8e8e93] select-none">$ </span>}
            {l.text || " "}
          </div>
        ))}
      </div>
      <form
        className="flex items-center gap-2 border-t border-white/10 px-3 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void run(input);
        }}
      >
        <span className="text-[#8e8e93] select-none">{busy ? "…" : "$"}</span>
        <input
          ref={field}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && history.length) {
              e.preventDefault();
              const n = cursor === null ? 0 : Math.min(cursor + 1, history.length - 1);
              setCursor(n);
              setInput(history[n]);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const n = cursor === null ? null : cursor - 1 < 0 ? null : cursor - 1;
              setCursor(n);
              setInput(n === null ? "" : history[n]);
            } else if (e.key === "l" && e.ctrlKey) {
              e.preventDefault();
              setLines([]);
            }
          }}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          aria-label="Terminal command"
          placeholder={busy ? "running…" : ""}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#636366]"
        />
      </form>
    </div>
  );
});
