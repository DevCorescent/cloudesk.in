"use client";

// Diwali on the homepage, for the festive days only (DIWALI in lib/festive.ts),
// in fine gold on the dark hero. Above: two strands of warm fairy lights at
// different depths, lanterns swaying on their threads, embers drifting up.
// Under the hero, edge to edge on soft pastel: a marigold toran across the
// top, petals drifting down, rangoli at the sides, and the launch & Diwali
// offer — a gift whose lid lifts as it comes into view, light spilling out
// and a card rising from inside ("3 months of Cloudesk, free"), beside "This
// Diwali, grow your business with Cloudesk" and the time left. After the offer ends the gift
// holds the Diwali wish instead. Decoration is hidden from screen readers and
// stays still for people who ask for less motion. Styles: .dv-* in
// (marketing)/marketing.css.
import { ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LAUNCH_OFFER } from "@/lib/festive";
import { W } from "./sections";

/* ───────── the hero: lights, lanterns, embers ───────── */

function Strand({ n, sag, top, depth }: { n: number; sag: number; top: number; depth: "near" | "far" }) {
  return (
    <div className={`dv-strand dv-strand-${depth}`} style={{ top }}>
      <svg className="absolute inset-x-0 top-0 h-[80px] w-full" viewBox="0 0 1600 80" preserveAspectRatio="none">
        <path d={`M0 1 Q800 ${sag * 2 + 1} 1600 1`} fill="none" stroke="url(#dv-wire)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <defs>
          <linearGradient id="dv-wire" x1="0" x2="1">
            <stop offset="0" stopColor="rgb(255 214 150 / 0)" />
            <stop offset="0.15" stopColor="rgb(255 214 150 / 0.32)" />
            <stop offset="0.85" stopColor="rgb(255 214 150 / 0.32)" />
            <stop offset="1" stopColor="rgb(255 214 150 / 0)" />
          </linearGradient>
        </defs>
      </svg>
      {Array.from({ length: n }, (_, i) => {
        const x = (i + 0.5) / n;
        return <span key={i} className={i % 2 ? "dv-light dv-light-odd" : "dv-light"} style={{ left: `${x * 100}%`, top: 1 + sag * 4 * x * (1 - x), "--d": `${(i * 0.53) % 3.4}s` } as CSSProperties} />;
      })}
    </div>
  );
}

/** A paper lantern (akash kandil) in gold line, glowing from inside, on its thread. */
function Lantern({ x, drop, size, delay }: { x: string; drop: number; size: number; delay: number }) {
  return (
    <span className="dv-lantern" style={{ left: x, "--drop": `${drop}px`, "--d": `${delay}s` } as CSSProperties}>
      <i className="dv-thread" />
      <svg viewBox="0 0 40 70" width={size} height={size * 1.75}>
        <defs>
          <radialGradient id="dv-lglow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffd98a" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ff9a3d" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="20" cy="30" rx="20" ry="22" fill="url(#dv-lglow)" opacity="0.55" />
        <path d="M20 6 L34 24 L20 52 L6 24 Z" fill="rgb(255 190 100 / 0.12)" stroke="#e9b45c" strokeWidth="1.1" />
        <path d="M6 24 H34 M13 15 L27 15 M20 6 V52" fill="none" stroke="#e9b45c" strokeWidth="0.8" opacity="0.7" />
        <path d="M14 52 h12 l-2 4 h-8 z" fill="#e9b45c" opacity="0.85" />
        <path d="M17 56 v10 M20 56 v12 M23 56 v10" stroke="#e9b45c" strokeWidth="0.8" opacity="0.7" />
      </svg>
    </span>
  );
}

export function DiwaliHero() {
  return (
    <div aria-hidden className="dv-hero pointer-events-none absolute inset-x-0 top-16 -z-[1] h-[min(78%,620px)] overflow-hidden">
      <Strand n={34} sag={22} top={8} depth="far" />
      <Strand n={26} sag={38} top={0} depth="near" />
      <Lantern x="6%" drop={64} size={26} delay={0} />
      <Lantern x="18%" drop={36} size={18} delay={1.2} />
      <Lantern x="84%" drop={48} size={22} delay={0.6} />
      <Lantern x="94%" drop={78} size={28} delay={1.8} />
      {Array.from({ length: 16 }, (_, i) => (
        <span key={i} className="dv-ember" style={{ left: `${(i * 53 + 7) % 100}%`, "--d": `${(i * 1.3) % 10}s`, "--t": `${10 + (i % 5) * 2.4}s`, "--x": `${(i % 2 ? 1 : -1) * (10 + (i % 4) * 9)}px` } as CSSProperties} />
      ))}
    </div>
  );
}

/* ───────── under the hero: the gift ───────── */

/** A mandala in fine gold line, for the band's edges. */
function Mandala({ className }: { className?: string }) {
  const petals = (n: number, r: number, l: number, w: number) =>
    Array.from({ length: n }, (_, i) => <path key={`${r}-${i}`} d={`M100 ${100 - r} q ${w} ${-l / 2} 0 ${-l} q ${-w} ${l / 2} 0 ${l}`} transform={`rotate(${(360 / n) * i} 100 100)`} />);
  return (
    <svg aria-hidden viewBox="0 0 200 200" className={className} fill="none" stroke="currentColor" strokeWidth="0.45">
      <circle cx="100" cy="100" r="96" />
      <circle cx="100" cy="100" r="92" strokeDasharray="1 3" />
      <circle cx="100" cy="100" r="62" />
      <circle cx="100" cy="100" r="30" />
      <circle cx="100" cy="100" r="8" />
      {petals(24, 64, 28, 6)}
      {petals(16, 32, 26, 7)}
      {petals(8, 10, 18, 6)}
      {Array.from({ length: 48 }, (_, i) => <circle key={i} cx="100" cy="6" r="0.9" fill="currentColor" stroke="none" transform={`rotate(${7.5 * i} 100 100)`} />)}
    </svg>
  );
}

/** Time left until the offer's last day ends, ticking each minute (after mount, so the server and browser agree). */
function useLeft(until: string) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(until).getTime() - Date.now()));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

/** The box: its lid lifts, light spills out and the card rises from inside — when it's in view, or tapped. */
function GiftBox({ offer }: { offer: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setTimeout(() => setOpen(true), 350);
        io.disconnect();
      }
    }, { threshold: 0.45 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const replay = () => {
    setOpen(false);
    setRound((r) => r + 1);
    setTimeout(() => setOpen(true), 450);
  };
  return (
    <div ref={ref} className="dv-stage" data-open={open || undefined}>
      <div aria-hidden className="dv-rays" />
      <div aria-hidden className="dv-floor" />
      <div key={round} className="dv-gift">
        {/* The card inside, rising out as the lid lifts. */}
        <div className="dv-card-out" role="img" aria-label={offer ? `Three months of Cloudesk, free — the launch and Diwali offer, until ${LAUNCH_OFFER.lastDay}` : "Happy Diwali from Cloudesk"}>
          {offer ? (
            <>
              <span className="dv-card-kicker">Your Diwali gift</span>
              <span className="dv-card-big"><b>3</b> months</span>
              <span className="dv-card-sub">of Cloudesk, free</span>
              <span className="dv-card-foot">Launch &amp; Diwali offer · till 10 Nov</span>
            </>
          ) : (
            <>
              <span className="dv-card-kicker" lang="hi">शुभ दीपावली</span>
              <span className="dv-card-big">Happy</span>
              <span className="dv-card-sub">Diwali</span>
              <span className="dv-card-foot">from all of us at Cloudesk</span>
            </>
          )}
        </div>
        <div aria-hidden className="dv-box">
          <i className="dv-ribbon-v" />
          <i className="dv-box-sheen" />
        </div>
        <div aria-hidden className="dv-lid">
          <i className="dv-ribbon-v" />
          <span className="dv-bow"><i /><i /><b /></span>
        </div>
        <div aria-hidden className="dv-burst">
          {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ "--a": `${(360 / 14) * i}deg`, "--r": `${70 + (i % 3) * 26}px`, "--d": `${(i % 4) * 60}ms` } as CSSProperties} />)}
        </div>
      </div>
      <button type="button" onClick={replay} className="dv-replay" aria-label="Open the gift again"><RotateCcw className="size-3.5" /> Open again</button>
    </div>
  );
}

/** A marigold toran: blooms strung on gentle swags, mango leaves and a gold drop at each join. Tiled, so it never stretches. */
function Toran() {
  const bloom = (t: number) => {
    // Along the swag M0 4 Q120 54 240 4.
    const x = 240 * t;
    const y = 4 + 100 * t * (1 - t);
    return { x, y };
  };
  return (
    <svg aria-hidden className="dv-toran" width="100%" height="78">
      <defs>
        <radialGradient id="dv-mg" cx="45%" cy="40%" r="60%">
          <stop offset="0" stopColor="#ffd36b" />
          <stop offset="0.55" stopColor="#f6a43a" />
          <stop offset="1" stopColor="#e07b1f" />
        </radialGradient>
        <radialGradient id="dv-mg2" cx="45%" cy="40%" r="60%">
          <stop offset="0" stopColor="#fff0a8" />
          <stop offset="0.6" stopColor="#f7c948" />
          <stop offset="1" stopColor="#e3a21a" />
        </radialGradient>
        <pattern id="dv-toran" width="240" height="78" patternUnits="userSpaceOnUse">
          <path d="M0 4 Q120 54 240 4" fill="none" stroke="#c8922f" strokeWidth="0.8" opacity="0.6" />
          {Array.from({ length: 9 }, (_, i) => {
            const { x, y } = bloom((i + 0.5) / 9);
            return (
              <g key={i} transform={`translate(${x} ${y})`}>
                <circle r="7.2" fill={i % 2 ? "url(#dv-mg2)" : "url(#dv-mg)"} />
                <circle r="7.2" fill="none" stroke="#c46a12" strokeWidth="0.9" strokeDasharray="1.4 1.8" opacity="0.55" />
                <circle r="2.2" fill="#c0621a" opacity="0.55" />
              </g>
            );
          })}
          {/* Mango leaves and a gold drop where the swags meet. */}
          <path d="M0 4 q-7 14 0 30 q7 -16 0 -30 z" fill="#7fae6b" opacity="0.9" />
          <path d="M2 6 q12 10 10 26 q-12 -8 -10 -26 z" fill="#93c07d" opacity="0.85" />
          <path d="M-2 6 q-12 10 -10 26 q12 -8 10 -26 z" fill="#93c07d" opacity="0.85" />
          <path d="M240 4 q-7 14 0 30 q7 -16 0 -30 z" fill="#7fae6b" opacity="0.9" />
          <path d="M242 6 q12 10 10 26 q-12 -8 -10 -26 z" fill="#93c07d" opacity="0.85" />
          <path d="M238 6 q-12 10 -10 26 q12 -8 10 -26 z" fill="#93c07d" opacity="0.85" />
          <path d="M120 30 v12" stroke="#c8922f" strokeWidth="0.8" opacity="0.6" />
          <path d="M120 41 c-4 6 -4 10 0 13 c4 -3 4 -7 0 -13 z" fill="#e3b14d" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100%" height="78" fill="url(#dv-toran)" />
    </svg>
  );
}

/** Marigold petals drifting down, a few at a time. */
function Petals() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className="dv-petal" style={{ left: `${(i * 37 + 6) % 96}%`, "--d": `${(i * 1.7) % 12}s`, "--t": `${12 + (i % 4) * 3}s`, "--x": `${(i % 2 ? 1 : -1) * (30 + (i % 3) * 25)}px`, "--c": i % 3 ? "#f6a43a" : "#f7c948" } as CSSProperties} />
      ))}
    </div>
  );
}

export function DiwaliBand({ offer }: { offer: boolean }) {
  const left = useLeft(LAUNCH_OFFER.until);
  const d = left === null ? null : { days: Math.floor(left / 86_400_000), hours: Math.floor((left % 86_400_000) / 3_600_000) };
  return (
    <section aria-labelledby="diwali-gift" className="dv-band relative isolate mb-24 overflow-hidden sm:mb-36 lg:mb-40">
      <Toran />
      <Petals />
      <Mandala className="dv-mandala dv-mandala-l" />
      <Mandala className="dv-mandala dv-mandala-r" />
      <div className={`${W} relative grid grid-cols-[minmax(0,1fr)] items-center gap-8 pt-24 pb-12 sm:pt-28 sm:pb-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14 lg:pt-28 lg:pb-16`}>
        <div className="max-lg:order-2 max-lg:text-center">
          <p lang="hi" className="dv-in text-[15px] font-medium text-[#a8622a]">शुभ दीपावली</p>
          <h2 id="diwali-gift" className="dv-in mt-3 text-[clamp(2.1rem,4.4vw,3.9rem)] leading-[1.04] font-[350] tracking-[-0.04em] text-[#2b1d12] text-balance" style={{ animationDelay: "90ms" }}>
            {offer ? <>This Diwali, grow your business with <span className="dv-gold">Cloudesk.</span></> : <>Happy <span className="dv-gold">Diwali.</span></>}
          </h2>
          <p className="dv-in mt-4 text-[clamp(1rem,1.25vw,1.1rem)] text-[#5b4636]/80" style={{ animationDelay: "180ms" }}>
            {offer ? <>3 months of every feature, free — till {LAUNCH_OFFER.lastDay}.</> : <>Wishing you a year of light, joy and growth.</>}
          </p>
          {offer && (
            <div className="dv-in mt-7 flex flex-wrap items-center gap-x-5 gap-y-3 max-lg:justify-center" style={{ animationDelay: "270ms" }}>
              <Link href="/start" className="dv-cta">Claim offer <ArrowRight className="dv-cta-arrow size-4" /></Link>
              <Link href="/features" className="dv-ghost">What&apos;s included <ArrowRight className="size-3.5" /></Link>
              <span className="dv-left" aria-live="polite">{d ? `Ends in ${d.days}d ${d.hours}h` : "Ends 10 Nov"}</span>
            </div>
          )}
        </div>
        <div className="max-lg:order-1">
          <GiftBox offer={offer} />
        </div>
      </div>
      <div aria-hidden className="dv-deepmala">
        {Array.from({ length: 21 }, (_, i) => <span key={i} className={i % 2 ? "dv-mini dv-mini-odd" : "dv-mini"} style={{ "--d": `${(i * 0.31) % 2}s` } as CSSProperties}><i /></span>)}
      </div>
    </section>
  );
}
