"use client";

// The homepage's closing section, above the footer: how Cloudesk helps a
// business, told in numbers with a graphic each rather than paragraphs. Every
// number is a fact about the product (feature count, templates, trial,
// commission, GST rates) — no invented customer statistics. Counters and
// graphics play once the section is on screen; still for reduced motion.
import { freeFor } from "@/lib/festive";
import clsx from "clsx";
import { ArrowRight, Check, Globe, IndianRupee, LayoutGrid, Receipt, ShoppingBag, Store, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FEATURES } from "./features";
import { W } from "./sections";

/** Counts up to `to` once `on` turns true. */
function Count({ to, on, prefix = "", suffix = "", ms = 1400 }: { to: number; on: boolean; prefix?: string; suffix?: string; ms?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    // Reduced motion: the same frame callback, finishing at once.
    const span = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = span ? Math.min(1, (now - start) / span) : 1;
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, to, ms]);
  return <span className="tabular-nums">{prefix}{n}{suffix}</span>;
}

function Tile({ big, label, graphic, className, tone }: { big: ReactNode; label: string; graphic: ReactNode; className?: string; tone: string }) {
  return (
    <div className={clsx("im-tile relative flex flex-col overflow-hidden rounded-[28px] p-6 sm:p-7", className)} style={{ ["--im" as string]: tone }}>
      <div className="im-graphic relative flex min-h-[150px] flex-1 items-center justify-center">{graphic}</div>
      <div className="mt-5">
        <p className="text-[clamp(2.6rem,4.4vw,3.6rem)] leading-none font-[340] tracking-[-0.05em]">{big}</p>
        <p className="mt-2 text-[14.5px] text-fg/58">{label}</p>
      </div>
    </div>
  );
}

/* ───────── graphics ───────── */

/** Ten scattered apps folding into one. */
function Converge() {
  const spots = [[-80, -46], [-30, -62], [40, -58], [86, -30], [-96, 6], [96, 16], [-72, 52], [-12, 64], [54, 58], [8, -14]];
  return (
    <div className="relative size-[180px]">
      {spots.map(([x, y], k) => (
        <span key={k} className="im-app absolute top-1/2 left-1/2 size-8 rounded-[10px] bg-white shadow-[0_8px_18px_-8px_rgb(30_20_70/0.35)] ring-1 ring-fg/[0.07]" style={{ "--x": `${x}px`, "--y": `${y}px`, "--k": k } as CSSProperties} />
      ))}
      <span className="im-one absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[18px] bg-fg text-bg shadow-[0_20px_40px_-16px_rgb(30_20_70/0.6)]"><LayoutGrid className="size-7" /></span>
    </div>
  );
}

/** A stopwatch ring filling to three minutes. */
function Ring({ on }: { on: boolean }) {
  return (
    <div className="relative size-[150px]">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="9" className="text-fg/[0.07]" />
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--im)" strokeWidth="9" strokeLinecap="round" pathLength={1} className={clsx("im-ring", on && "is-on")} />
      </svg>
      <span className="absolute inset-0 grid place-content-center text-center">
        <b className="text-[26px] leading-none font-[380] tracking-[-0.03em] tabular-nums">3:00</b>
        <span className="mt-1 text-[10.5px] font-medium tracking-[0.12em] text-fg/45 uppercase">to live</span>
      </span>
    </div>
  );
}

/** A ₹1,000 sale: all of it yours, nothing to Cloudesk. */
function Commission() {
  return (
    <div className="grid w-full max-w-[270px] gap-3 text-[12px]">
      <div>
        <p className="mb-1.5 flex justify-between text-fg/55"><span>A sale in your store</span><b className="font-semibold text-fg tabular-nums">₹1,000</b></p>
        <span className="relative block h-3.5 overflow-hidden rounded-full bg-fg/[0.05]"><span className="im-bar absolute inset-0 rounded-full bg-[var(--im)]" style={{ "--k": 0 } as CSSProperties} /></span>
      </div>
      <div>
        <p className="mb-1.5 flex justify-between text-fg/55"><span>Cloudesk&apos;s cut</span><b className="font-semibold text-fg tabular-nums">₹0</b></p>
        <span className="relative block h-3.5 overflow-hidden rounded-full bg-fg/[0.05]"><span className="im-bar absolute inset-y-0 left-0 w-[2%] rounded-full bg-fg/25" style={{ "--k": 1 } as CSSProperties} /></span>
      </div>
      <p className="text-[10.5px] leading-snug text-fg/40">Payment gateway fees are your provider&apos;s.</p>
    </div>
  );
}

/** Every feature as a dot, lighting up in a wave. */
function Dots({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-9 gap-1.5">
      {FEATURES.slice(0, n).map((f, k) => (
        <span key={f.slug} title={f.name} className={clsx("im-dot grid size-[22px] place-items-center rounded-[7px]", `tint-${f.tint}`)} style={{ "--k": k } as CSSProperties}>
          <f.icon className="size-3" />
        </span>
      ))}
    </div>
  );
}

/** One customer typed once, showing up everywhere. */
function Once() {
  const to: [ReactNode, string][] = [[<Users key="c" className="size-4" />, "CRM"], [<Receipt key="i" className="size-4" />, "Invoices"], [<ShoppingBag key="s" className="size-4" />, "Store"], [<Store key="p" className="size-4" />, "POS"], [<Globe key="w" className="size-4" />, "Website"]];
  return (
    <div className="flex w-full max-w-[420px] items-center gap-3">
      <span className="im-src shrink-0 rounded-[14px] bg-white px-3 py-2.5 text-[12px] shadow-[0_12px_26px_-14px_rgb(30_20_70/0.4)] ring-1 ring-fg/[0.07]">
        <b className="block font-semibold">Rao &amp; Sons</b><span className="text-fg/50">typed once</span>
      </span>
      <div className="grid flex-1 gap-1.5">
        {to.map(([icon, x], k) => (
          <span key={x} className="flex items-center gap-2" style={{ "--k": k } as CSSProperties}>
            <span className="relative h-px flex-1 bg-fg/10"><span className="im-pulse absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-[var(--im)]" /></span>
            <span className="im-dest inline-flex w-[104px] items-center gap-1.5 rounded-full bg-white py-1 pr-2.5 pl-1 text-[11.5px] font-medium ring-1 ring-fg/[0.07]"><span className="grid size-6 place-items-center rounded-full bg-[color-mix(in_srgb,var(--im)_16%,white)] text-[var(--im)]">{icon}</span>{x}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** GST rates, picked in one tap. */
function Gst() {
  return (
    <div className="grid justify-items-center gap-3">
      <div className="flex gap-1.5">
        {[5, 12, 18, 28].map((r, k) => (
          <span key={r} className={clsx("im-rate rounded-full px-3 py-1.5 text-[13px] font-semibold tabular-nums", r === 18 ? "bg-[var(--im)] text-white" : "bg-white text-fg/60 ring-1 ring-fg/[0.07]")} style={{ "--k": k } as CSSProperties}>{r}%</span>
        ))}
      </div>
      <span className="im-rate inline-flex items-center gap-2 rounded-[14px] bg-white px-3.5 py-2 text-[12.5px] ring-1 ring-fg/[0.07]" style={{ "--k": 5 } as CSSProperties}>
        <IndianRupee className="size-3.5 text-[var(--im)]" /> CGST 9% + SGST 9% · <b className="font-semibold">auto</b>
      </span>
    </div>
  );
}

export function Impact() {
  const root = useRef<HTMLElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return void setOn(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setOn(true), io.disconnect()), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const total = FEATURES.length;
  return (
    <section ref={root} id="impact" data-on={on || undefined} aria-labelledby="impact-title" className="im relative py-14 sm:py-20">
      <span aria-hidden className="im-band pointer-events-none absolute inset-0 -z-10" />
      <div className={W}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">How Cloudesk helps</p>
            <h2 id="impact-title" className="mt-3 text-[clamp(2rem,4.2vw,3.5rem)] leading-[1.04] font-[360] tracking-[-0.045em] text-balance">Less to juggle. <span className="mk-logo-gradient">More to show for it.</span></h2>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-fg/55">
            {["No card needed", `Free for ${freeFor()}`, "Export your data any time"].map((x) => <li key={x} className="inline-flex items-center gap-1.5"><Check className="size-4 text-[var(--p-mint-ink)]" />{x}</li>)}
          </ul>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:mt-12 lg:grid-cols-12">
          <Tile className="lg:col-span-4" tone="#5b48b0" big={<><Count to={1} on={on} /> <span className="text-fg/35">login</span></>} label="instead of ten apps that don't talk to each other" graphic={<Converge />} />
          <Tile className="lg:col-span-4" tone="#e8774a" big={<>~<Count to={3} on={on} /> <span className="text-fg/35">min</span></>} label="to set up your business, with the right features switched on" graphic={<Ring on={on} />} />
          <Tile className="lg:col-span-4" tone="#1f9d6b" big={<><Count to={0} on={on} />% <span className="text-fg/35">commission</span></>} label="on what you sell in your own store — UPI, cards and COD" graphic={<Commission />} />
          <Tile className="lg:col-span-5" tone="#3b7ddd" big={<><Count to={total} on={on} /> <span className="text-fg/35">features</span></>} label="switch on only what you need — the rest stays out of the way" graphic={<Dots n={total} />} />
          <Tile className="lg:col-span-7" tone="#7c6be0" big={<><Count to={1} on={on} />× <span className="text-fg/35">typed</span></>} label="a customer, product or price is entered once and used everywhere" graphic={<Once />} />
          <Tile className="lg:col-span-4" tone="#c98a1c" big={<><Count to={26} on={on} /> <span className="text-fg/35">templates</span></>} label="by industry, in 11 design styles, with your name already in" graphic={<TemplateFan />} />
          <Tile className="lg:col-span-4" tone="#1f9d6b" big={<><Count to={4} on={on} /> <span className="text-fg/35">GST rates</span></>} label="one tap on any invoice; CGST, SGST or IGST worked out for you" graphic={<Gst />} />
          <div className="im-tile im-cta relative flex flex-col justify-between overflow-hidden rounded-[28px] p-7 text-white sm:col-span-2 lg:col-span-4">
            <span aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-[radial-gradient(closest-side,rgb(255_122_89/0.45),transparent)] blur-xl" />
            <p className="relative text-[clamp(1.6rem,2.4vw,2.1rem)] leading-[1.1] font-[360] tracking-[-0.04em]">See it working on your business — <span className="text-white/55">in about three minutes.</span></p>
            <div className="relative mt-8 flex flex-wrap gap-2.5">
              <Link href="/start" className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14.5px] font-semibold text-[#0b0b0c] transition-transform hover:-translate-y-0.5">Start free <ArrowRight className="size-4" /></Link>
              <Link href="/pricing" className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-medium ring-1 ring-white/25 transition-colors hover:bg-white/10">See pricing</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Template cards fanning out. */
function TemplateFan() {
  const tints = ["lavender", "peach", "mint", "sky", "rose"];
  return (
    <div className="relative h-[130px] w-[200px]">
      {tints.map((t, k) => (
        <span key={t} className={clsx("im-card absolute bottom-0 left-1/2 h-[110px] w-[78px] origin-bottom rounded-[12px] bg-white p-1.5 shadow-[0_12px_26px_-12px_rgb(30_20_70/0.4)] ring-1 ring-fg/[0.07]", `tint-${t}`)} style={{ "--k": k, "--r": `${(k - 2) * 13}deg` } as CSSProperties}>
          <span className="block h-[46%] rounded-[8px]" style={{ background: "var(--t)" }} />
          <span className="mt-1.5 block h-1.5 w-3/4 rounded-full bg-fg/10" />
          <span className="mt-1 block h-1.5 w-1/2 rounded-full bg-fg/10" />
        </span>
      ))}
    </div>
  );
}
