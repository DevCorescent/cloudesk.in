"use client";

// A deck of real screenshots stacked like cards. Every few seconds the front
// card slides away and tucks in at the back, so the deck walks through the
// steps. Click a step to jump; it waits on hover and holds still for reduced motion.
import clsx from "clsx";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Shot } from "./shot-tour";

export type StackCard = { label: string; shot: Shot };

const STEP_MS = 3800;
const DEPTH = 4;

export function StackHero({ cards }: { cards: StackCard[] }) {
  const n = cards.length;
  const [front, setFront] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const [still, setStill] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const go = (to: number) => {
    if (to === front) return;
    setLeaving(front);
    setFront(to);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLeaving(null), 700);
  };

  useEffect(() => {
    if (hover || still) return;
    const t = setTimeout(() => go((front + 1) % n), STEP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm on every step
  }, [front, hover, still, n]);

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="relative mx-auto aspect-[1440/900] w-full max-w-[1180px]" style={{ marginTop: `${DEPTH * 22}px` }}>
        {cards.map((c, i) => {
          const k = (i - front + n) % n;
          const out = i === leaving;
          const style: CSSProperties = out
            ? { transform: "translateY(18%) rotate(-3deg) scale(0.96)", opacity: 0, zIndex: n + 1 }
            : { transform: `translateY(${-k * 22}px) scale(${1 - k * 0.05})`, opacity: k >= DEPTH ? 0 : 1 - k * 0.12, zIndex: n - k };
          return (
            <div key={c.label} aria-hidden={k !== 0} className="absolute inset-0 origin-top transition-[transform,opacity] duration-700 ease-[cubic-bezier(.16,1,.3,1)]" style={style}>
              <div className="h-full overflow-hidden rounded-[14px] bg-[var(--surface-solid)] shadow-[0_50px_100px_-50px_rgb(30_20_70/0.55),0_0_0_1px_rgb(0_0_0/0.07)] sm:rounded-[20px]">
                <div className="flex h-7 items-center gap-1.5 border-b border-fg/[0.06] px-3 sm:h-9 sm:px-4">
                  <span className="size-2 rounded-full bg-[#ff5f57] sm:size-2.5" />
                  <span className="size-2 rounded-full bg-[#febc2e] sm:size-2.5" />
                  <span className="size-2 rounded-full bg-[#28c840] sm:size-2.5" />
                  <span className="mx-auto rounded-full bg-fg/[0.05] px-3 py-0.5 text-[10.5px] font-medium text-fg/50">{c.label}</span>
                </div>
                <div className="relative h-[calc(100%-1.75rem)] sm:h-[calc(100%-2.25rem)]">
                  <Image src={c.shot.src} alt={c.shot.alt} fill priority={i === 0} sizes="(min-width: 1280px) 1180px, 100vw" className="object-cover object-top" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="-mx-5 mt-8 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex w-max gap-1 rounded-full bg-fg/[0.04] p-1">
          {cards.map((c, i) => (
            <button key={c.label} type="button" onClick={() => go(i)} aria-current={i === front ? "step" : undefined} className={clsx("relative overflow-hidden rounded-full px-3.5 py-2 text-[12.5px] font-medium whitespace-nowrap transition-colors", i === front ? "bg-[var(--surface-solid)] text-fg shadow-sm ring-1 ring-fg/[0.06]" : "text-fg/50 hover:text-fg")}>
              <span className="mr-1.5 tabular-nums opacity-50">{String(i + 1).padStart(2, "0")}</span>
              {c.label}
              {i === front && !still && !hover && <span key={front} aria-hidden className="bs-progress absolute inset-x-3 bottom-0.5 block h-[2px] rounded-full bg-[var(--t-ink)]" style={{ "--bs-dur": `${STEP_MS}ms` } as CSSProperties} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
