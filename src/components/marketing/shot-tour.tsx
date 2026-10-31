"use client";

// Product-screenshot storytelling for feature pages: a hero screenshot that
// straightens as you scroll, and a stack of chapter cards that pile up on
// each other (each card sticks, and the ones underneath shrink and dim).
// Screenshots are real captures of the app; hotspots point at what matters.
import clsx from "clsx";
import { Check } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Mark } from "./interactive";

export type Shot = { src: string; w: number; h: number; alt: string };
/** A marker on a screenshot; `above` puts the label over the point instead of beside it. */
export type Hotspot = { x: number; y: number; label: string; above?: boolean };
/** Zoom into part of a screenshot: scale `s` around the point x%, y%. */
export type Zoom = { x: number; y: number; s: number };
export type Chapter = {
  key: string;
  eyebrow: string;
  title: string;
  /** Part of `title` to highlight. */
  mark: string;
  body: string;
  bullets: string[];
  tone: "lavender" | "peach" | "mint" | "sky" | "butter" | "rose";
  shot: Shot;
  hotspots?: Hotspot[];
  zoom?: Zoom;
  /** A cropped close-up of one panel or dialog, shown whole without a browser frame. */
  panel?: boolean;
  /** An optional close-up that floats over the screenshot. */
  detail?: Shot & { side?: "left" | "right" };
};

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setR(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return r;
}

/** Where a point on the full screenshot lands once zoomed. */
const zoomed = (z: Zoom | undefined, h: Hotspot): Hotspot => (z ? { ...h, x: z.x + (h.x - z.x) * z.s, y: z.y + (h.y - z.y) * z.s } : h);

/** A screenshot in a quiet browser frame (or `bare`, for close-ups). */
export function ShotFrame({ shot, url = "Cloudesk", priority, bare, zoom, sizes = "(min-width: 1024px) 60vw, 100vw", className, children }: { shot: Shot; url?: string; priority?: boolean; bare?: boolean; zoom?: Zoom; sizes?: string; className?: string; children?: ReactNode }) {
  return (
    <div className={clsx("relative overflow-hidden bg-[var(--surface-solid)] shadow-[0_40px_80px_-40px_rgb(30_20_70/0.45),0_0_0_1px_rgb(0_0_0/0.06)]", bare ? "rounded-[16px]" : "rounded-[14px] sm:rounded-[18px]", className)}>
      {!bare && (
        <div className="flex h-7 items-center gap-1.5 border-b border-fg/[0.06] px-3 sm:h-9 sm:px-4">
          <span className="size-2 rounded-full bg-[#ff5f57] sm:size-2.5" />
          <span className="size-2 rounded-full bg-[#febc2e] sm:size-2.5" />
          <span className="size-2 rounded-full bg-[#28c840] sm:size-2.5" />
          <span className="mx-auto hidden rounded-full bg-fg/[0.05] px-3 py-0.5 text-[10.5px] font-medium text-fg/45 sm:block">{url}</span>
        </div>
      )}
      <div className="relative overflow-hidden">
        <Image src={shot.src} alt={shot.alt} width={shot.w} height={shot.h} priority={priority} sizes={sizes} className="block h-auto w-full" style={zoom ? { transform: `scale(${zoom.s})`, transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined} />
        {children}
      </div>
    </div>
  );
}

/** Pulsing markers with labels, shown once the card is in view. */
function Hotspots({ spots, on }: { spots: Hotspot[]; on: boolean }) {
  return (
    <>
      {spots.map((h, i) => (
        <span key={h.label} aria-hidden className={clsx("st-spot absolute hidden -translate-x-1/2 -translate-y-1/2 sm:block", on && "st-on")} style={{ left: `${h.x}%`, top: `${h.y}%`, "--at": `${500 + i * 260}ms` } as CSSProperties}>
          <span className="st-ring absolute top-1/2 left-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full" />
          <span className="relative block size-3 rounded-full bg-[var(--t-ink)] ring-[3px] ring-white" />
          <span className={clsx("absolute rounded-full bg-fg px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-bg shadow-lg", h.above ? "bottom-5 left-1/2 -translate-x-1/2" : clsx("top-1/2 -translate-y-1/2", h.x > 60 ? "right-5" : "left-5"))}>{h.label}</span>
        </span>
      ))}
    </>
  );
}

/** Scroll progress of an element into view: 0 at the bottom of the screen, 1 once 20% from the top. */
export function useScrollIn<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  const [p, setP] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        setP(Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.8))));
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, [reduced]);
  return { ref, p: reduced ? 1 : p, reduced };
}

/** Tilted back in perspective at `p` = 0, flat at 1. */
export const tiltStyle = (p: number): CSSProperties => {
  const t = 0.35 + 0.65 * p;
  return { transform: `rotateX(${(1 - t) * 22}deg) scale(${0.9 + 0.1 * t})` };
};

/** Hero screenshot: tilted back in perspective, straightening as it scrolls into place. */
export function TiltShot({ shot, detailLeft, detailRight, leftWidth = "30%" }: { shot: Shot; detailLeft?: Shot; detailRight?: Shot; leftWidth?: string }) {
  const { ref, p } = useScrollIn<HTMLDivElement>();
  return (
    <div ref={ref} className="relative [perspective:1600px]">
      <div className="relative origin-top transition-transform duration-100 ease-out will-change-transform" style={tiltStyle(p)}>
        <ShotFrame shot={shot} priority />
      </div>
      {detailLeft && (
        <div className="st-pop absolute -bottom-6 -left-2 hidden md:block lg:-left-8" style={{ "--at": "700ms", width: leftWidth } as CSSProperties}>
          <ShotFrame shot={detailLeft} bare sizes="45vw" className="rounded-[18px]!" />
        </div>
      )}
      {detailRight && (
        <div className="st-pop absolute -right-2 -bottom-10 hidden w-[22%] md:block lg:-right-8" style={{ "--at": "950ms" } as CSSProperties}>
          <ShotFrame shot={detailRight} bare sizes="22vw" className="rounded-[26px]! ring-[6px] ring-fg" />
        </div>
      )}
    </div>
  );
}

/**
 * The chapter stack. On large screens each card sticks a little lower than
 * the one before, so they pile up; cards underneath shrink and dim as the
 * next one slides over. On phones it's a plain list.
 */
export function StackTour({ chapters }: { chapters: Chapter[] }) {
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const [depth, setDepth] = useState<number[]>(() => chapters.map(() => 0));
  const [seen, setSeen] = useState<boolean[]>(() => chapters.map(() => false));
  const reduced = useReducedMotion();

  useEffect(() => {
    const els = items.current.filter(Boolean) as HTMLLIElement[];
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (!e.isIntersecting) continue;
          const i = els.indexOf(e.target as HTMLLIElement);
          setSeen((s) => (s[i] ? s : s.map((v, k) => (k === i ? true : v))));
        }
      },
      { threshold: 0.35 },
    );
    els.forEach((el) => io.observe(el));
    if (reduced) return () => io.disconnect();
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!window.matchMedia("(min-width: 1024px)").matches) return setDepth((d) => (d.some(Boolean) ? d.map(() => 0) : d));
        const rects = els.map((el) => el.getBoundingClientRect());
        const tops = els.map((el) => parseFloat(getComputedStyle(el).top) || 0);
        // How far each later card has slid over its resting place, 0..1.
        const cover = rects.map((r, j) => (j === 0 ? 0 : Math.min(1, Math.max(0, 1 - (r.top - tops[j]) / Math.max(1, rects[j - 1].height)))));
        setDepth(rects.map((_, i) => cover.slice(i + 1).reduce((a, b) => a + b, 0)));
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, [reduced]);

  // Each card sticks a little lower than the last; long tours share 144px so the pile stays short.
  const step = Math.min(18, 144 / Math.max(1, chapters.length - 1));
  return (
    <ol className="relative grid gap-6 lg:gap-0">
      {chapters.map((c, i) => {
        const d = depth[i] ?? 0;
        const [before, ...rest] = c.title.split(c.mark);
        return (
          <li
            key={c.key}
            ref={(el) => {
              items.current[i] = el;
            }}
            className="lg:sticky lg:pb-10"
            style={{ top: `calc(5.5rem + ${i * step}px)`, zIndex: i + 1 } as CSSProperties}
          >
            <article
              className={clsx("tint-card relative overflow-hidden rounded-[30px] ring-1 ring-fg/[0.06] sm:rounded-[40px] lg:shadow-[0_-24px_60px_-40px_rgb(30_20_70/0.35)]", `tint-${c.tone}`)}
              style={{ transform: d ? `scale(${1 - Math.min(d, 3) * 0.035})` : undefined, transformOrigin: "50% 0%", transition: "transform 120ms linear" }}
            >
              <span aria-hidden className="pointer-events-none absolute inset-0 z-20 bg-[var(--surface-solid)] transition-opacity duration-150" style={{ opacity: Math.min(0.55, d * 0.22) }} />
              <div className="grid grid-cols-1 items-center gap-8 p-5 sm:p-9 lg:min-h-[min(640px,calc(100dvh-9rem))] lg:grid-cols-[0.72fr_1.28fr] lg:gap-12 lg:p-12">
                <div className={clsx("st-text", seen[i] && "st-on")}>
                  <p className="flex items-center gap-3 text-[13px] font-medium text-fg/55">
                    <span className="tint-chip grid size-8 place-items-center rounded-full text-[12px] font-semibold tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    {c.eyebrow}
                  </p>
                  <h3 className="mt-5 text-[clamp(1.7rem,3vw,2.7rem)] leading-[1.06] font-[380] tracking-[-0.035em] text-balance">
                    {before}
                    <Mark tone={c.tone} delay={300}>{c.mark}</Mark>
                    {rest.join(c.mark)}
                  </h3>
                  <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-fg/60">{c.body}</p>
                  <ul className="mt-6 grid gap-2.5">
                    {c.bullets.map((b, k) => (
                      <li key={b} className="st-item flex items-start gap-2.5 text-[14.5px]" style={{ "--at": `${250 + k * 110}ms` } as CSSProperties}>
                        <span className="tint-chip mt-0.5 grid size-5 shrink-0 place-items-center rounded-full"><Check className="size-3" strokeWidth={3} /></span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={clsx("st-media relative", seen[i] && "st-on")}>
                  {c.panel ? (
                    <div className="flex justify-center">
                      <div className="relative overflow-hidden rounded-[22px] bg-[var(--surface-solid)] shadow-[0_40px_80px_-40px_rgb(30_20_70/0.45),0_0_0_1px_rgb(0_0_0/0.06)]">
                        <Image src={c.shot.src} alt={c.shot.alt} width={c.shot.w} height={c.shot.h} sizes="(min-width: 1024px) 50vw, 100vw" className="block h-auto max-h-[min(560px,70vh)] w-auto max-w-full" />
                      </div>
                    </div>
                  ) : (
                    <ShotFrame shot={c.shot} zoom={c.zoom}>{c.hotspots && <Hotspots spots={c.hotspots.map((h) => zoomed(c.zoom, h))} on={seen[i]} />}</ShotFrame>
                  )}
                  {c.detail && (
                    <div className={clsx("st-pop absolute -bottom-5 hidden w-[34%] sm:block", c.detail.side === "left" ? "-left-4" : "-right-4")} style={{ "--at": "650ms" } as CSSProperties}>
                      <ShotFrame shot={c.detail} bare sizes="20vw" />
                    </div>
                  )}
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
