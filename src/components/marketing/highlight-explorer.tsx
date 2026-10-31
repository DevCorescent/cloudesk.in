"use client";

// "In detail" for feature pages: pick a highlight on the left and it opens
// large on the right. It steps through on its own until someone takes over,
// and the card's glow follows the pointer.
import clsx from "clsx";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

type Highlight = { title: string; body: string };

const STEP_MS = 4500;

export function HighlightExplorer({ items }: { items: Highlight[] }) {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [seen, setSeen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);

  // Only start stepping once the section is on screen, and never with reduced motion.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting && !still), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !seen) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % items.length), STEP_MS);
    return () => clearTimeout(t);
  }, [active, auto, seen, items.length]);

  const pick = (i: number) => {
    setAuto(false);
    setActive(i);
  };
  const glow = (e: PointerEvent<HTMLDivElement>) => {
    const r = card.current?.getBoundingClientRect();
    if (!r) return;
    card.current!.style.setProperty("--gx", `${((e.clientX - r.left) / r.width) * 100}%`);
    card.current!.style.setProperty("--gy", `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  const h = items[active];

  return (
    <div ref={root} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8">
      <ul className="grid gap-2" role="tablist" aria-label="Highlights">
        {items.map((it, i) => (
          <li key={it.title}>
            <button
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => pick(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const n = (active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
                  pick(n);
                  (e.currentTarget.closest("ul")?.querySelectorAll("button")[n] as HTMLButtonElement | undefined)?.focus();
                }
              }}
              className={clsx(
                "group relative flex w-full items-center gap-3 overflow-hidden rounded-[18px] px-4 py-3.5 text-left transition-all duration-300",
                i === active ? "tint-card shadow-[0_10px_30px_-18px_rgba(0,0,0,0.35)]" : "hover:bg-fg/[0.04]",
              )}
            >
              <span className={clsx("grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums transition-colors", i === active ? "tint-chip" : "bg-fg/[0.06] text-fg/50")}>{i + 1}</span>
              <span className={clsx("text-[15px] font-semibold tracking-tight transition-colors", i === active ? "text-fg" : "text-fg/60 group-hover:text-fg")}>{it.title}</span>
              {i === active && auto && seen && <span key={active} aria-hidden className="hx-bar absolute inset-x-4 bottom-1.5 h-[2px] origin-left rounded-full bg-current opacity-25" style={{ "--d": `${STEP_MS}ms` } as CSSProperties} />}
            </button>
          </li>
        ))}
      </ul>
      <div ref={card} onPointerMove={glow} className="hx-card p-glass relative min-h-[260px] overflow-hidden rounded-[28px] p-7 sm:p-10 lg:sticky lg:top-24 lg:self-start" role="tabpanel" aria-live="polite">
        <span aria-hidden className="hx-glow pointer-events-none absolute inset-0" />
        <span aria-hidden className="pointer-events-none absolute -top-6 -right-2 text-[160px] leading-none font-semibold tracking-[-0.06em] text-fg/[0.05] tabular-nums select-none">
          {String(active + 1).padStart(2, "0")}
        </span>
        <div key={active} className="hx-in relative">
          <span className="tint-chip inline-grid size-10 place-items-center rounded-full">
            <Check className="size-5" />
          </span>
          <h3 className="mt-6 max-w-md text-[clamp(1.5rem,3vw,2.1rem)] leading-[1.1] font-[380] tracking-[-0.035em] text-balance">{h.title}</h3>
          <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-fg/60">{h.body}</p>
        </div>
        <div className="relative mt-8 flex gap-1.5" aria-hidden>
          {items.map((it, i) => (
            <span key={it.title} className={clsx("h-1.5 rounded-full transition-all duration-500", i === active ? "tint-ink w-8 bg-current" : "w-1.5 bg-fg/15")} />
          ))}
        </div>
      </div>
    </div>
  );
}
