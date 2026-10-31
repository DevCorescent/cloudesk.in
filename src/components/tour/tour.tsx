"use client";

// A guided tour: a soft spotlight glides to each part of the screen while a
// glass card explains it. Targets are elements marked data-tour="…"; a step
// whose target isn't on screen (a closed menu on a phone) is shown centred.
// Keys: → / Enter next, ← back, Esc to close.
import clsx from "clsx";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type TourStep = { target?: string; title: string; body: ReactNode; icon?: ReactNode; cta?: ReactNode };

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;
const CARD_W = 360;

function findTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    // Skip hidden copies (e.g. the desktop sidebar on a phone).
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

export function Tour({ steps, open, onClose, label = "Product tour" }: { steps: TourStep[]; open: boolean; onClose: (finished: boolean) => void; label?: string }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  const step = steps[i];
  const last = i === steps.length - 1;

  // Called every frame while open; state only changes when something actually moved.
  const measure = useCallback(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    setVp((v) => (v.w === w && v.h === h ? v : { w, h }));
    const el = findTarget(step?.target);
    if (!el) return setRect((r) => (r === null ? r : null));
    const b = el.getBoundingClientRect();
    const n = { top: Math.round(b.top - PAD), left: Math.round(b.left - PAD), width: Math.round(b.width + PAD * 2), height: Math.round(b.height + PAD * 2) };
    setRect((r) => (r && r.top === n.top && r.left === n.left && r.width === n.width && r.height === n.height ? r : n));
  }, [step?.target]);

  // Bring the target into view, then follow it while the page moves.
  useEffect(() => {
    if (!open) return;
    const el = findTarget(step?.target);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 80) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    let raf = 0;
    const loop = () => {
      measure();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, step?.target, measure]);

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [i, open, vp.w]);

  const next = useCallback(() => (last ? onClose(true) : setI((x) => x + 1)), [last, onClose]);
  const back = useCallback(() => setI((x) => Math.max(0, x - 1)), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      else if (e.key === "ArrowRight" || (e.key === "Enter" && !(e.target as HTMLElement).closest("button,a"))) next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, onClose]);
  useEffect(() => {
    if (open) card.current?.focus({ preventScroll: true });
  }, [open, i]);

  if (!open || !step || typeof document === "undefined") return null;

  // Place the card beside the target: right, then below, above, left; centred when there's no target.
  const phone = vp.w < 640;
  const w = Math.min(CARD_W, vp.w - 32);
  let pos: { top: number; left: number };
  if (phone) pos = { top: vp.h - cardH - 16, left: 16 };
  else if (!rect) pos = { top: vp.h / 2 - cardH / 2, left: vp.w / 2 - w / 2 };
  else {
    const gap = 16;
    const fits = {
      right: rect.left + rect.width + gap + w < vp.w - 16,
      below: rect.top + rect.height + gap + cardH < vp.h - 16,
      above: rect.top - gap - cardH > 16,
    };
    if (fits.right) pos = { top: rect.top + rect.height / 2 - cardH / 2, left: rect.left + rect.width + gap };
    else if (fits.below) pos = { top: rect.top + rect.height + gap, left: rect.left + rect.width / 2 - w / 2 };
    else if (fits.above) pos = { top: rect.top - gap - cardH, left: rect.left + rect.width / 2 - w / 2 };
    else pos = { top: rect.top + rect.height / 2 - cardH / 2, left: rect.left - gap - w };
    pos = { top: Math.max(16, Math.min(vp.h - cardH - 16, pos.top)), left: Math.max(16, Math.min(vp.w - w - 16, pos.left)) };
  }
  // With no target, the spotlight shrinks to a point in the middle (the whole page dims).
  const spot = rect ?? { top: vp.h / 2, left: vp.w / 2, width: 0, height: 0 };

  return createPortal(
    // The page is paused during the tour; clicks outside the card do nothing (no accidental exits).
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[89]" onClick={(e) => e.stopPropagation()}>
      <div className="tour-spot" data-empty={!rect} style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />
      <div ref={card} tabIndex={-1} className="tour-card outline-none" style={{ top: pos.top, left: pos.left, width: w }}>
        <div key={i} className="tour-card-inner glass-strong overflow-hidden rounded-[22px] shadow-[0_40px_80px_-30px_rgb(0_0_0/.6)]">
          <div className="h-1 bg-fg/[0.06]">
            <div className="h-full bg-gradient-to-r from-[#f4b796] via-[#c3b6f6] to-[#94dcbc] transition-[width] duration-500 ease-out" style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
          </div>
          <div className="p-5">
            <div className="flex items-start gap-3">
              {step.icon && <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-fg text-bg [&_svg]:size-[18px]">{step.icon}</span>}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
                  {i + 1} of {steps.length}
                </p>
                <h2 className="mt-0.5 text-[17px] leading-snug font-semibold tracking-[-0.015em]">{step.title}</h2>
              </div>
              <button type="button" onClick={() => onClose(false)} aria-label="Close tour" className="-mt-1 -mr-1 grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-2.5 text-[13.5px] leading-relaxed text-muted">{step.body}</div>
            {step.cta && <div className="mt-3">{step.cta}</div>}
            <div className="mt-4 flex items-center gap-2">
              <span className="flex gap-1" aria-hidden>
                {steps.map((_, j) => (
                  <span key={j} className={clsx("h-1.5 rounded-full transition-all duration-300", j === i ? "w-4 bg-fg" : "w-1.5 bg-fg/20")} />
                ))}
              </span>
              <span className="ml-auto flex gap-1.5">
                {i > 0 && (
                  <button type="button" onClick={back} className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
                    <ArrowLeft className="size-3.5" /> Back
                  </button>
                )}
                <button type="button" onClick={next} className={clsx("inline-flex h-8 items-center gap-1 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg transition-transform active:scale-95", last && "lx-sheen")}>
                  {last ? "Done" : i === 0 ? "Show me" : "Next"} {!last && <ArrowRight className="size-3.5" />}
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
