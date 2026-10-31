// Read-only drawing of a note's blocks: the published page, printouts and the
// editor's preview of a block you're not typing in. Server-safe (no state).
// Text is rendered from parsed spans — never as HTML — and only http(s) and
// in-app links become links.
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";
import { calcResults, spans, type Block, type Doc } from "@/lib/notes/blocks";

const safeHref = (h?: string) => (h && /^(https?:\/\/|\/(?!\/))/i.test(h) ? h : undefined);

export function Inline({ text, onNote }: { text: string; onNote?: (title: string) => void }) {
  if (!text) return null;
  return (
    <>
      {spans(text).map((p, i) => {
        switch (p.t) {
          case "b": return <strong key={i} className="font-semibold">{p.text}</strong>;
          case "i": return <em key={i}>{p.text}</em>;
          case "s": return <s key={i} className="opacity-70">{p.text}</s>;
          case "code": return <code key={i} className="rounded-[5px] bg-fg/[0.07] px-1 py-px font-mono text-[0.88em]">{p.text}</code>;
          case "mark": return <mark key={i} className="rounded-[3px] bg-[#fde68a] px-0.5 text-inherit dark:bg-[#854d0e]">{p.text}</mark>;
          case "link": {
            const h = safeHref(p.href);
            return h ? <a key={i} href={h} target={h.startsWith("/") ? undefined : "_blank"} rel="noreferrer noopener" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">{p.text}</a> : <span key={i}>{p.text}</span>;
          }
          case "note": return onNote ? <button key={i} type="button" onClick={(e) => (e.stopPropagation(), onNote(p.text))} className="rounded-[5px] bg-accent-soft px-1 font-medium text-accent hover:underline">{p.text}</button> : <span key={i} className="rounded-[5px] bg-fg/[0.06] px-1 font-medium">{p.text}</span>;
          case "mention": return <span key={i} className="font-medium text-accent">@{p.text}</span>;
          default: return <span key={i}>{p.text}</span>;
        }
      })}
    </>
  );
}

export const TONES: Record<string, { icon: ReactNode; cls: string; label: string }> = {
  info: { icon: <Info className="size-4" />, cls: "bg-[#e0f2fe] text-[#075985] dark:bg-[#0c4a6e]/40 dark:text-[#bae6fd]", label: "Info" },
  idea: { icon: <Lightbulb className="size-4" />, cls: "bg-[#fef9c3] text-[#854d0e] dark:bg-[#713f12]/40 dark:text-[#fde68a]", label: "Idea" },
  success: { icon: <CheckCircle2 className="size-4" />, cls: "bg-[#dcfce7] text-[#166534] dark:bg-[#14532d]/40 dark:text-[#bbf7d0]", label: "Done" },
  warning: { icon: <AlertTriangle className="size-4" />, cls: "bg-[#ffedd5] text-[#9a3412] dark:bg-[#7c2d12]/40 dark:text-[#fed7aa]", label: "Careful" },
  danger: { icon: <OctagonAlert className="size-4" />, cls: "bg-[#fee2e2] text-[#991b1b] dark:bg-[#7f1d1d]/40 dark:text-[#fecaca]", label: "Important" },
};

export const fmtNum = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 6 });

/** One block, read-only. `n` is its number in a numbered list. */
export function BlockView({ b, n, calc, onNote, onToggle }: { b: Block; n?: number; calc?: ReturnType<typeof calcResults>; onNote?: (t: string) => void; onToggle?: (checked: boolean) => void }) {
  const pad = { paddingLeft: `${(b.indent ?? 0) * 1.5}rem` };
  const t = <Inline text={b.text} onNote={onNote} />;
  switch (b.type) {
    case "h1": return <h2 data-no-fit className="mt-2 text-[1.7em] leading-tight font-semibold tracking-tight">{t}</h2>;
    case "h2": return <h3 data-no-fit className="mt-1.5 text-[1.35em] leading-snug font-semibold tracking-tight">{t}</h3>;
    case "h3": return <h4 data-no-fit className="mt-1 text-[1.12em] font-semibold">{t}</h4>;
    case "todo":
      return (
        <div className="flex items-start gap-2.5" style={pad}>
          <input type="checkbox" checked={!!b.checked} readOnly={!onToggle} onChange={(e) => onToggle?.(e.target.checked)} aria-label={b.text || "To-do"} className="mt-[0.3em] size-4 shrink-0 accent-[var(--accent)]" />
          <span className={clsx(b.checked && "text-muted line-through")}>{t}</span>
        </div>
      );
    case "bullet": return <div className="flex gap-2.5" style={pad}><span className="mt-[0.62em] size-1.5 shrink-0 rounded-full bg-fg/60" aria-hidden />{t}</div>;
    case "number": return <div className="flex gap-2" style={pad}><span className="min-w-[1.4em] shrink-0 text-right text-muted tabular-nums">{n ?? 1}.</span><span>{t}</span></div>;
    case "quote": return <blockquote className="border-l-[3px] border-fg/25 pl-4 text-fg/80 italic">{t}</blockquote>;
    case "callout": {
      const tone = TONES[b.tone ?? "info"] ?? TONES.info!;
      return <div className={clsx("flex gap-3 rounded-[12px] px-4 py-3", tone.cls)}><span className="mt-[0.2em] shrink-0">{tone.icon}</span><div className="min-w-0">{t}</div></div>;
    }
    case "code": return <pre className="overflow-x-auto rounded-[12px] bg-fg/[0.05] p-4 font-mono text-[0.86em] leading-relaxed"><code>{b.text}</code></pre>;
    case "divider": return <hr className="my-2 border-border" />;
    case "toggle":
      return (
        <details open={b.open} className="group rounded-[10px]">
          <summary className="cursor-pointer list-none font-medium marker:hidden"><span className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>{t}</summary>
          <div className="mt-1 pl-5 whitespace-pre-wrap text-fg/80"><Inline text={b.body ?? ""} onNote={onNote} /></div>
        </details>
      );
    case "table": {
      const [head = [], ...rest] = b.rows ?? [];
      return (
        <div className="overflow-x-auto rounded-[10px] ring-1 ring-border">
          <table className="w-full text-[0.92em]">
            <thead className="bg-fg/[0.04]"><tr>{head.map((h, i) => <th key={i} className="border-b border-border px-3 py-2 text-left font-semibold"><Inline text={h} /></th>)}</tr></thead>
            <tbody>{rest.map((r, i) => <tr key={i} className="border-b border-border/60 last:border-0">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top"><Inline text={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    case "calc": {
      const r = calc?.get(b.id);
      return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-[10px] bg-fg/[0.035] px-3 py-2 font-mono text-[0.92em]">
          <span className="min-w-0"><span className="mr-2 font-sans text-[0.85em] text-muted">{b.lang || "="}</span>{b.text}</span>
          {r && ("value" in r ? <b className="text-[1.05em] tabular-nums">{fmtNum(r.value)}</b> : <span className="font-sans text-[0.85em] text-danger">{r.error}</span>)}
        </div>
      );
    }
    case "image": {
      const h = safeHref(b.url);
      return h ? (
        <figure className="grid gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- images from anywhere the author linked */}
          <img src={h} alt={b.caption ?? ""} loading="lazy" referrerPolicy="no-referrer" className="max-h-[520px] w-auto max-w-full rounded-[12px] object-contain ring-1 ring-border" />
          {b.caption && <figcaption className="text-[0.85em] text-muted">{b.caption}</figcaption>}
        </figure>
      ) : null;
    }
    case "link":
    case "record": {
      const h = safeHref(b.url);
      return (
        <a href={h} target={h?.startsWith("/") ? undefined : "_blank"} rel="noreferrer noopener" className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 ring-1 ring-border transition-colors hover:bg-fg/[0.03]">
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-[13px] text-accent">{b.type === "record" ? "◆" : "↗"}</span>
          <span className="min-w-0"><span className="block truncate font-medium">{b.text || b.url}</span>{(b.sub || b.module) && <span className="block truncate text-[0.85em] text-muted">{[b.module, b.sub].filter(Boolean).join(" · ")}</span>}</span>
        </a>
      );
    }
    case "date": return <div className="inline-flex items-center gap-2 rounded-full bg-fg/[0.05] px-3 py-1 text-[0.92em]">📅 {b.date ? new Date(`${b.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "No date"}{b.text && <span className="text-muted">· <Inline text={b.text} /></span>}</div>;
    default: return <p className="min-h-[1.5em] whitespace-pre-wrap">{t}</p>;
  }
}

/** Numbers for numbered lists (restarting after anything else). */
export function numbering(blocks: Block[]) {
  const out = new Map<string, number>();
  let n = 0;
  for (const b of blocks) {
    n = b.type === "number" ? n + 1 : 0;
    if (b.type === "number") out.set(b.id, n);
  }
  return out;
}

export function DocView({ doc, className }: { doc: Doc; className?: string }) {
  const calc = calcResults(doc);
  const nums = numbering(doc.blocks);
  return (
    <div className={clsx("grid gap-2.5 text-[16px] leading-relaxed", className)}>
      {doc.blocks.map((b) => <BlockView key={b.id} b={b} n={nums.get(b.id)} calc={calc} />)}
    </div>
  );
}
