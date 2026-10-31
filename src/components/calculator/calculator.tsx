"use client";

// The calculator itself: type or tap, see the answer as you go, press = (or
// Enter) to keep it in your history. Memory keys, quick GST buttons, a
// scientific keypad, your own variables, and the result in words.
import clsx from "clsx";
import { Copy, Delete, FlaskConical, MessagesSquare, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useShareToChat } from "@/components/chat/share";
import { useToast } from "@/components/ui/overlays";
import { CalcError, evaluate, FUNCTIONS } from "@/lib/calculator/expr";
import { rupeesInWords, shortIndian } from "@/lib/calculator/format";
import { copy, fmt, useCalcSettings, useHistoryActions } from "./shared";

export type CalculatorHandle = { load: (expr: string) => void };
type Line = { expr: string; value: number };

const KEYS: { k: string; label?: string; kind?: "op" | "fn" | "eq" | "clear" | "mem" | "back" }[][] = [
  [{ k: "AC", kind: "clear" }, { k: "(" }, { k: ")" }, { k: "%", kind: "op" }, { k: "÷", kind: "op" }],
  [{ k: "7" }, { k: "8" }, { k: "9" }, { k: "back", label: "⌫", kind: "back" }, { k: "×", kind: "op" }],
  [{ k: "4" }, { k: "5" }, { k: "6" }, { k: "^", label: "xʸ", kind: "op" }, { k: "−", kind: "op" }],
  [{ k: "1" }, { k: "2" }, { k: "3" }, { k: "sqrt(", label: "√", kind: "fn" }, { k: "+", kind: "op" }],
  [{ k: "00" }, { k: "0" }, { k: "." }, { k: "ans", label: "Ans", kind: "fn" }, { k: "=", kind: "eq" }],
];
const SCI = ["sin(", "cos(", "tan(", "asin(", "acos(", "atan(", "ln(", "log(", "exp(", "pi", "e", "!", "abs(", "round(", "min(", "max(", "avg(", "mod"];
const GST = [5, 12, 18, 28];

export const Calculator = forwardRef<CalculatorHandle>(function Calculator(_, ref) {
  const [s, set] = useCalcSettings();
  const { save } = useHistoryActions();
  const toast = useToast();
  const { available: canShare, share } = useShareToChat();
  const [expr, setExpr] = useState("");
  const [ans, setAns] = useState(0);
  const [last, setLast] = useState<Line | null>(null);
  const [tape, setTape] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recall, setRecall] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ load: (e: string) => { setExpr(e); setError(null); input.current?.focus(); } }), []);
  useEffect(() => input.current?.focus(), []);

  const env = useMemo(() => ({ vars: s.vars, ans, angle: s.angle }), [s.vars, ans, s.angle]);
  // The answer as you type (nothing shown while the expression is incomplete).
  const preview = useMemo(() => {
    if (!expr.trim()) return null;
    try {
      return evaluate(expr, env);
    } catch {
      return null;
    }
  }, [expr, env]);

  const insert = (t: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? expr.length;
    // After a finished answer, an operator continues from it; a number starts fresh.
    const base = last && expr === last.expr && !/^[+\-−×÷^%!)]/.test(t) && !t.startsWith("mod") ? "" : expr;
    const next = base === "" && last && expr === last.expr ? t : base.slice(0, start) + t + base.slice(end);
    setExpr(next);
    setError(null);
    requestAnimationFrame(() => {
      const pos = (base === "" ? 0 : start) + t.length;
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    });
  };

  const equals = () => {
    if (!expr.trim()) return;
    try {
      const r = evaluate(expr, env);
      if (r.assign) set({ vars: { ...s.vars, [r.assign]: r.value } });
      setAns(r.value);
      const line = { expr: r.assign ? expr : `${expr}`, value: r.value };
      setLast(line);
      setTape((t) => [line, ...t].slice(0, 50));
      setRecall(-1);
      save.mutate({ kind: "expr", input: expr.trim(), result: `${r.assign ? `${r.assign} = ` : ""}${fmt(r.value, s)}`, resultValue: r.value });
      setExpr(String(r.value));
      setLast({ expr: String(r.value), value: r.value });
    } catch (e) {
      setError(e instanceof CalcError ? e.message : "That can't be worked out");
    }
  };

  const press = (k: string) => {
    if (k === "AC") {
      setExpr("");
      setError(null);
      setLast(null);
      return;
    }
    if (k === "back") {
      setExpr((x) => x.slice(0, -1));
      setError(null);
      return;
    }
    if (k === "=") return equals();
    insert(k === "mod" ? " mod " : k);
  };

  const value = last && expr === last.expr ? last.value : preview?.value ?? null;
  const words = value !== null && Math.abs(value) < 1e15 ? rupeesInWords(value) : "";
  const short = value !== null ? shortIndian(value) : "";

  return (
    <div className="grid gap-4">
      {/* Display */}
      <div className="rounded-[22px] bg-surface p-4 ring-1 ring-border sm:p-5">
        <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-full bg-surface-2 px-2.5 py-1 font-medium uppercase hover:text-fg" onClick={() => set({ angle: s.angle === "deg" ? "rad" : "deg" })} title="Angle unit for sin, cos and tan">{s.angle}</button>
            {s.memory !== 0 && <span className="rounded-full bg-accent/10 px-2.5 py-1 font-medium text-accent" title="In memory">M {fmt(s.memory, s)}</span>}
          </div>
          <span className="tabular-nums">{ans !== 0 && <>Ans = {fmt(ans, s)}</>}</span>
        </div>
        <label className="sr-only" htmlFor="calc-input">Calculation</label>
        <input
          id="calc-input"
          ref={input}
          value={expr}
          autoComplete="off"
          spellCheck={false}
          inputMode="decimal"
          onChange={(e) => {
            setExpr(e.target.value);
            setError(null);
            setLast(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              equals();
            } else if (e.key === "Escape") {
              setExpr("");
              setError(null);
            } else if (e.key === "ArrowUp" && tape.length) {
              e.preventDefault();
              const i = Math.min(tape.length - 1, recall + 1);
              setRecall(i);
              setExpr(tape[i]!.expr);
            } else if (e.key === "ArrowDown" && recall >= 0) {
              e.preventDefault();
              const i = recall - 1;
              setRecall(i);
              setExpr(i >= 0 ? tape[i]!.expr : "");
            }
          }}
          placeholder="e.g. 1,25,000 + 18%  ·  rate = 9  ·  sqrt(2)"
          className="mt-3 w-full bg-transparent text-right font-mono text-[22px] tracking-tight outline-none placeholder:text-[15px] placeholder:text-muted/60 sm:text-[26px]"
        />
        <div className="mt-1 min-h-[52px] text-right" aria-live="polite">
          {error ? (
            <p className="text-[14px] text-danger">{error}</p>
          ) : value !== null ? (
            <p className={clsx("font-mono tabular-nums tracking-tight", last && expr === last.expr ? "text-[38px] leading-tight font-semibold sm:text-[44px]" : "text-[22px] text-muted")}>= {fmt(value, s)}</p>
          ) : null}
        </div>
        {value !== null && !error && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted">{short && <span className="mr-2 font-medium text-fg">{short}</span>}{words}</p>
            <div className="flex gap-1">
              <IconBtn label="Copy the result" onClick={() => void copy(String(value), toast)}><Copy className="size-4" /></IconBtn>
              {canShare && <IconBtn label="Share to chat" onClick={() => share({ kind: "calculator", title: `${expr && expr !== String(value) ? `${expr} = ` : ""}${fmt(value, s)}`, sub: words, module: "Calculator" })}><MessagesSquare className="size-4" /></IconBtn>}
            </div>
          </div>
        )}
      </div>

      {/* Memory and GST shortcuts */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {[
          { l: "MC", t: "Clear memory", f: () => set({ memory: 0 }) },
          { l: "MR", t: "Use the number in memory", f: () => insert(String(s.memory)) },
          { l: "M+", t: "Add the result to memory", f: () => value !== null && set({ memory: s.memory + value }) },
          { l: "M−", t: "Subtract the result from memory", f: () => value !== null && set({ memory: s.memory - value }) },
        ].map((b) => <Key key={b.l} label={b.l} title={b.t} kind="mem" onClick={b.f} />)}
        {GST.map((r) => <Key key={r} label={`+${r}%`} title={`Add ${r}% GST`} kind="fn" onClick={() => insert(` + ${r}%`)} />)}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-5 gap-2">
        {KEYS.flat().map((k) => <Key key={k.k} label={k.label ?? k.k} kind={k.kind} onClick={() => press(k.k)} icon={k.kind === "back" ? <Delete className="size-5" /> : undefined} />)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => set({ sci: !s.sci })} className={clsx("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium ring-1 transition-colors", s.sci ? "bg-fg text-bg ring-fg" : "ring-border hover:bg-surface-2")}><FlaskConical className="size-4" /> Scientific</button>
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          <label className="flex items-center gap-1.5">Grouping
            <select className="rounded-full bg-surface-2 px-2 py-1 text-fg" value={s.grouping} onChange={(e) => set({ grouping: e.target.value as "indian" | "international" })}><option value="indian">1,00,000</option><option value="international">100,000</option></select>
          </label>
          <label className="flex items-center gap-1.5">Decimals
            <select className="rounded-full bg-surface-2 px-2 py-1 text-fg" value={String(s.decimals)} onChange={(e) => set({ decimals: e.target.value === "auto" ? "auto" : (Number(e.target.value) as 0 | 2 | 4) })}><option value="auto">Auto</option><option value="0">0</option><option value="2">2</option><option value="4">4</option></select>
          </label>
        </div>
      </div>
      {s.sci && (
        <div className="grid grid-cols-6 gap-2">
          {SCI.map((k) => <Key key={k} label={k.replace("(", "")} title={FUNCTIONS[k.replace("(", "")]?.help} kind="fn" onClick={() => press(k)} />)}
        </div>
      )}

      {/* Variables and the tape */}
      {(Object.keys(s.vars).length > 0 || tape.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.keys(s.vars).length > 0 && (
            <div className="rounded-[16px] bg-surface p-3 ring-1 ring-border">
              <p className="mb-2 text-[11.5px] font-semibold tracking-[0.1em] text-muted uppercase">Your values</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(s.vars).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-2.5 font-mono text-[12.5px]">
                    <button type="button" onClick={() => insert(k)} title="Insert">{k} = {fmt(v, s)}</button>
                    <button type="button" aria-label={`Forget ${k}`} className="grid size-5 place-items-center rounded-full hover:bg-surface-3" onClick={() => { const { [k]: _gone, ...rest } = s.vars; void _gone; set({ vars: rest }); }}><X className="size-3" /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {tape.length > 0 && (
            <div className="rounded-[16px] bg-surface p-3 ring-1 ring-border">
              <div className="mb-2 flex items-center justify-between"><p className="text-[11.5px] font-semibold tracking-[0.1em] text-muted uppercase">This session</p><button type="button" className="text-[12px] text-muted hover:text-fg" onClick={() => setTape([])}>Clear</button></div>
              <ul className="max-h-40 space-y-1 overflow-y-auto font-mono text-[12.5px]">
                {tape.map((l, i) => (
                  <li key={i}><button type="button" className="flex w-full justify-between gap-3 rounded-[8px] px-1.5 py-0.5 text-left hover:bg-surface-2" onClick={() => { setExpr(l.expr); setLast(null); input.current?.focus(); }}><span className="truncate text-muted">{l.expr}</span><span className="shrink-0">= {fmt(l.value, s)}</span></button></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <p className="text-[12px] text-muted">Tips: <code>200 + 18%</code> adds GST · <code>18% of 200</code> · <code>rate = 9</code> saves a value · <code>gst(1000, 18)</code>, <code>exgst(1180, 18)</code>, <code>change(80, 100)</code> · ↑ / ↓ go through this session · Enter saves to history.</p>
    </div>
  );
});

function Key({ label, kind, onClick, title, icon }: { label: string; kind?: string; onClick: () => void; title?: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={kind === "back" ? "Delete" : title ?? label}
      onClick={onClick}
      className={clsx(
        "grid h-12 place-items-center rounded-[14px] text-[16px] font-medium tabular-nums transition-[transform,background] active:scale-[0.97] sm:h-14 sm:text-[17px]",
        kind === "eq" ? "bg-fg text-bg hover:opacity-90" : kind === "op" ? "bg-accent/10 text-accent hover:bg-accent/15" : kind === "clear" ? "bg-danger/10 text-danger hover:bg-danger/15" : kind === "fn" || kind === "mem" ? "bg-surface-2 text-[13.5px] text-fg/80 hover:bg-surface-3" : "bg-surface text-fg ring-1 ring-border hover:bg-surface-2",
      )}
    >
      {icon ?? label}
    </button>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg">{children}</button>;
}
