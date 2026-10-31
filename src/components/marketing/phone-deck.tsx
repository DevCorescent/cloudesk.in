"use client";

// Homepage "quick actions": a 3D carousel of phones showing each feature's
// real screen, with a button to open the feature in front.
// The carousel loops, can be dragged or swiped, steps on its own while in
// view, and stands still for people who prefer reduced motion.
import clsx from "clsx";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { FEATURES } from "./features";

/** What each phone screen shows (captured from demo projects at 402×874). */
const SCREENS: Record<string, string> = {
  launch: "The launch flow on a phone: naming a new store and choosing what it sells",
  "website-builder": "A spa website built with the builder, on a phone",
  "online-store": "The Noir storefront on a phone",
  "point-of-sale": "The point-of-sale till on a phone, with products to tap",
  horeca: "A restaurant's QR menu on a phone, ordering from table P6",
  invoicing: "The Finance overview on a phone: money owed, overdue and collected",
  bookings: "Choosing a day and time to book a massage, on a phone",
  promotions: "A 10% off sign-up pop-up on a bakery's site, on a phone",
  growth: "Growth on a phone, with a running A/B test",
  domains: "Deployments on a phone, with a custom domain waiting for DNS",
  "ai-ide": "The code editor on a phone",
  automations: "Automations on a phone, each with its trigger and steps",
  chatbot: "Chatbot settings on a phone",
  data: "A Memberships data table on a phone",
  collaboration: "A client review link on a phone, with comments and Approve",
};

const ITEMS = FEATURES.filter((f) => SCREENS[f.slug]);
const N = ITEMS.length;
const STEP_MS = 3800;

/** Shortest signed distance from `active` to `i` around the loop. */
const loopOffset = (i: number, active: number) => {
  let d = (i - active) % N;
  if (d > N / 2) d -= N;
  if (d < -N / 2) d += N;
  return d;
};

function StatusBar() {
  return (
    <div aria-hidden className="relative z-10 flex h-[6.2%] shrink-0 items-end justify-between bg-white px-[9%] pb-[1.2%] text-[clamp(8px,0.9vw,12px)] font-semibold text-black">
      <span className="tabular-nums">9:41</span>
      <span className="flex items-center gap-[0.35em]">
        <svg viewBox="0 0 18 12" className="h-[0.8em]" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg viewBox="0 0 16 12" className="h-[0.8em]" fill="currentColor"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.3-1.4A10.4 10.4 0 0 0 8 .3 10.4 10.4 0 0 0 .7 3.2L2 4.6a8.5 8.5 0 0 1 6-2.4Zm0 3.8c1.3 0 2.5.5 3.4 1.3l1.3-1.4A6.8 6.8 0 0 0 8 4.1a6.8 6.8 0 0 0-4.7 1.8l1.3 1.4C5.5 6.5 6.7 6 8 6Zm0 3.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z" /></svg>
        <svg viewBox="0 0 27 12" className="h-[0.8em]"><rect x="0.5" y="0.5" width="23" height="11" rx="3.2" fill="none" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor" /><rect x="24.6" y="3.8" width="1.6" height="4.4" rx="0.8" fill="currentColor" opacity="0.4" /></svg>
      </span>
    </div>
  );
}

/** A phone drawn in CSS: titanium edge, thin black bezel, Dynamic Island and side buttons. */
export function PhoneFrame({ src, alt, priority, className }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={clsx("pd-phone relative aspect-[402/874] w-full", className)}>
      {/* Side buttons */}
      <span aria-hidden className="pd-btn absolute top-[17%] -left-[1.6%] h-[4.5%] w-[1.6%] rounded-l-[3px]" />
      <span aria-hidden className="pd-btn absolute top-[25%] -left-[1.6%] h-[8%] w-[1.6%] rounded-l-[3px]" />
      <span aria-hidden className="pd-btn absolute top-[35%] -left-[1.6%] h-[8%] w-[1.6%] rounded-l-[3px]" />
      <span aria-hidden className="pd-btn absolute top-[28%] -right-[1.6%] h-[12%] w-[1.6%] rounded-r-[3px]" />
      <span aria-hidden className="pd-btn absolute top-[56%] -right-[1.6%] h-[7%] w-[1.6%] rounded-r-[3px]" />
      <div className="pd-edge absolute inset-0 rounded-[16%/7.4%] p-[1.4%]">
        <div className="h-full w-full rounded-[15%/6.9%] bg-[#0b0b0c] p-[3%]">
          <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[12.6%/5.8%] bg-white">
            <StatusBar />
            <span aria-hidden className="absolute top-[1.35%] left-1/2 z-20 h-[3.9%] w-[31%] -translate-x-1/2 rounded-full bg-black" />
            <div className="relative min-h-0 flex-1">
              <Image src={src} alt={alt} fill priority={priority} sizes="(min-width: 1024px) 300px, 60vw" className="object-cover object-top" draggable={false} />
            </div>
            <span aria-hidden className="absolute bottom-[0.9%] left-1/2 z-20 h-[0.55%] w-[35%] -translate-x-1/2 rounded-full bg-black/80" />
            <span aria-hidden className="pd-glare pointer-events-none absolute inset-0 z-30" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PhoneDeck() {
  const [active, setActive] = useState(0);
  const [drag, setDrag] = useState(0); // in slides, while dragging
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [still, setStill] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; w: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  const go = useCallback((i: number) => setActive(((i % N) + N) % N), []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const io = new IntersectionObserver(([e]) => {
      setInView(e.isIntersecting);
      setStill(mq.matches);
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Step forward on its own while visible and nobody is interacting.
  useEffect(() => {
    if (!inView || paused || still || drag !== 0) return;
    const t = setTimeout(() => go(active + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [active, inView, paused, still, drag, go]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, w: Math.max(160, (stage.current?.clientWidth ?? 800) / 4.2), moved: false };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved && Math.abs(dx) > 6) {
      s.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (s.moved) setDrag(-dx / s.w);
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    dragged.current = !!s?.moved;
    if (!s?.moved) return;
    go(active + Math.round(drag));
    setDrag(0);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(active + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(active - 1);
    }
  };

  const f = ITEMS[active];
  const Icon = f.icon;

  return (
    <div ref={root} className={clsx("pd relative", `tint-${f.tint}`)} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {/* The phones */}
      <div
        ref={stage}
        role="region"
        aria-roledescription="carousel"
        aria-label="Every feature on a phone"
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={clsx("pd-stage relative mx-auto touch-pan-y outline-none select-none [perspective:1800px]", drag ? "cursor-grabbing" : "cursor-grab")}
      >
        <span aria-hidden className="pd-halo pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[min(780px,110vw)] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        {ITEMS.map((it, i) => {
          const d = loopOffset(i, active) - drag;
          const a = Math.abs(d);
          const hidden = a > 3.2;
          return (
            <div
              key={it.slug}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${N}: ${it.name}`}
              aria-hidden={a > 0.5}
              className={clsx("pd-slide absolute top-0 left-1/2 w-[var(--pw)]", drag !== 0 || still ? "duration-0" : "duration-[900ms]")}
              style={
                {
                  "--d": d,
                  "--a": Math.min(a, 3),
                  zIndex: 100 - Math.round(a * 10),
                  opacity: hidden ? 0 : 1,
                  pointerEvents: hidden ? "none" : undefined,
                } as CSSProperties
              }
              onClick={() => {
                if (a > 0.5 && !dragged.current) go(i);
              }}
            >
              <PhoneFrame src={`/marketing/phones/${it.slug}.jpg`} alt={SCREENS[it.slug]} priority={a < 1.5} />
            </div>
          );
        })}
      </div>

      {/* Caption for the phone in front */}
      <div className="relative mx-auto mt-8 flex max-w-xl flex-col items-center text-center sm:mt-10">
        <div key={f.slug} className="pd-cap flex flex-col items-center" aria-live="polite">
          <span className="tint-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold">
            <Icon className="size-3.5" /> {f.name}
          </span>
          <p className="mt-3 text-[clamp(1.15rem,2.2vw,1.45rem)] leading-snug font-medium tracking-[-0.02em] text-balance">{f.short}</p>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <button type="button" aria-label="Previous feature" onClick={() => go(active - 1)} className="grid size-11 place-items-center rounded-full bg-bg/80 ring-1 ring-fg/[0.08] backdrop-blur transition hover:-translate-x-0.5 hover:bg-bg">
            <ChevronLeft className="size-5" />
          </button>
          <Link href={`/features/${f.slug}`} className="p-cta lx-sheen inline-flex items-center gap-2 px-6">
            Open {f.name.toLowerCase()} <ArrowRight className="size-4" />
          </Link>
          <button type="button" aria-label="Next feature" onClick={() => go(active + 1)} className="grid size-11 place-items-center rounded-full bg-bg/80 ring-1 ring-fg/[0.08] backdrop-blur transition hover:translate-x-0.5 hover:bg-bg">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <div className="mt-6 flex items-center gap-1.5" aria-hidden>
          {ITEMS.map((it, i) => (
            <span key={it.slug} className={clsx("relative h-1.5 overflow-hidden rounded-full transition-all duration-500", i === active ? "tint-ink w-7" : "w-1.5 bg-fg/15")}>
              {i === active && <span key={active} className={clsx("pd-tick absolute inset-0 rounded-full bg-current", inView && !paused && !still && "pd-run")} style={{ "--step": `${STEP_MS}ms` } as CSSProperties} />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
