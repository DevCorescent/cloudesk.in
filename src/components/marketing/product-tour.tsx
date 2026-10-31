"use client";

// The homepage's "one app" window: real screens of each part of Creation
// Cloud inside a single app frame, switched from tabs in its title bar. It
// straightens as it scrolls in, autoplays while on screen, pauses on hover,
// and stays put for reduced motion. Screenshots are shown whole, never cropped.
import clsx from "clsx";
import { ArrowRight, Check, PanelsTopLeft, ReceiptText, ScanLine, ShoppingBag, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Wordmark } from "@/components/brand";
import { tiltStyle, useScrollIn } from "./shot-tour";

const STEP_MS = 6500;

type Tab = { key: string; label: string; short: string; icon: LucideIcon; tone: string; src: string; alt: string; title: string; points: string[]; href: string; cta: string };

const TABS: Tab[] = [
  {
    key: "builder",
    label: "Website",
    short: "Build it",
    icon: PanelsTopLeft,
    tone: "lavender",
    src: "/marketing/builder/overview.jpg",
    alt: "The website builder with a café homepage, its heading selected and the style inspector open",
    title: "Click any word on your site to change it.",
    points: ["Sections for everything", "11 design directions", "Phone preview built in"],
    href: "/features/website-builder",
    cta: "the builder",
  },
  {
    key: "store",
    label: "Online store",
    short: "Sell online",
    icon: ShoppingBag,
    tone: "peach",
    src: "/marketing/store/products.jpg",
    alt: "The store's product list with photos, stock and prices",
    title: "Add a product once. Sell it everywhere.",
    points: ["Photos, sizes and variants", "Excel & CSV import", "COD, UPI and cards"],
    href: "/features/online-store",
    cta: "the store",
  },
  {
    key: "pos",
    label: "Counter",
    short: "Sell in person",
    icon: ScanLine,
    tone: "mint",
    src: "/marketing/pos/till.jpg",
    alt: "The point-of-sale till with product photos and a sale paid by UPI",
    title: "Beep, bill, done — from the same stock.",
    points: ["Barcode scanning", "UPI QR for the exact total", "GST receipts"],
    href: "/features/point-of-sale",
    cta: "the till",
  },
  {
    key: "finance",
    label: "Finance",
    short: "Get paid",
    icon: ReceiptText,
    tone: "butter",
    src: "/marketing/finance/overview.jpg",
    alt: "The Finance overview: what you're owed, this year's totals and a 12-month chart",
    title: "Quotes, GST invoices and who owes what.",
    points: ["Pay-by-UPI on every invoice", "Friendly reminders", "Reports for your CA"],
    href: "/features/invoicing",
    cta: "Finance",
  },
];

export function ProductTour() {
  const { ref, p, reduced } = useScrollIn<HTMLDivElement>();
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  const paused = hover || !inView || reduced;
  const t = TABS[i];

  const tabs = (compact: boolean) =>
    TABS.map((tab, k) => (
      <button
        key={tab.key}
        type="button"
        role="tab"
        aria-selected={k === i}
        onClick={() => setI(k)}
        className={clsx(
          "relative flex shrink-0 items-center gap-2 overflow-hidden rounded-full font-medium whitespace-nowrap transition-all duration-300",
          compact ? "px-3.5 py-2 text-[13px]" : "px-3.5 py-1.5 text-[12.5px]",
          k === i ? "bg-[var(--surface-solid)] text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06),0_6px_16px_-8px_rgb(30_20_70/0.25)] ring-1 ring-fg/[0.06]" : "text-fg/50 hover:text-fg",
        )}
      >
        <span className="grid size-5 place-items-center rounded-full" style={k === i ? { background: `var(--p-${tab.tone})`, color: `var(--p-${tab.tone}-ink)` } : undefined}>
          <tab.icon className="size-3" />
        </span>
        {tab.label}
        {k === i && (
          <span aria-hidden className="absolute inset-x-3 bottom-0.5 h-[2px] overflow-hidden rounded-full">
            <span
              key={i}
              className="bs-progress block h-full"
              style={{ "--bs-dur": `${STEP_MS}ms`, background: `var(--p-${tab.tone}-ink)`, animationPlayState: paused ? "paused" : "running" } as CSSProperties}
              onAnimationEnd={() => {
                if (!reduced) setI((x) => (x + 1) % TABS.length);
              }}
            />
          </span>
        )}
      </button>
    ));

  return (
    <div ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* Phone/tablet: tabs above the window. */}
      <div className="-mx-5 mb-5 overflow-x-auto px-5 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
        <div role="tablist" aria-label="Parts of Cloudesk" className="flex w-max gap-1 rounded-full bg-fg/[0.04] p-1">
          {tabs(true)}
        </div>
      </div>

      <div className="relative [perspective:1800px]">
        <span aria-hidden className="pointer-events-none absolute inset-x-[4%] top-[10%] -z-10 h-[85%] rounded-full opacity-90 blur-3xl transition-[background] duration-700" style={{ background: `radial-gradient(closest-side, var(--p-${t.tone}), transparent)` }} />
        <div className="origin-top transition-transform duration-100 ease-out will-change-transform" style={tiltStyle(p)}>
          <div className="overflow-hidden rounded-[14px] bg-[var(--surface-solid)] shadow-[0_70px_120px_-60px_rgb(30_20_70/0.55),0_0_0_1px_rgb(0_0_0/0.07)] sm:rounded-[22px]">
            {/* Title bar: one app, with each part as a tab. */}
            <div className="flex h-8 items-center gap-3 border-b border-fg/[0.06] bg-fg/[0.02] px-3 sm:h-12 sm:px-4">
              <span className="flex gap-1.5">
                <span className="size-2 rounded-full bg-[#ff5f57] sm:size-2.5" />
                <span className="size-2 rounded-full bg-[#febc2e] sm:size-2.5" />
                <span className="size-2 rounded-full bg-[#28c840] sm:size-2.5" />
              </span>
              <span className="ml-1 hidden items-center gap-1.5 text-[12.5px] font-semibold md:flex">
                <Wordmark className="text-[14px]" />
              </span>
              <div role="tablist" aria-label="Parts of Cloudesk" className="mx-auto hidden gap-1 rounded-full bg-fg/[0.04] p-1 md:flex">
                {tabs(false)}
              </div>
              <span className="ml-auto hidden w-[118px] md:block" />
            </div>
            <div className="relative aspect-[1440/900] bg-fg/[0.02]">
              {TABS.map((tab, k) => (
                <Image key={tab.key} src={tab.src} alt={tab.alt} fill priority={k === 0} sizes="(min-width: 1280px) 1200px, 100vw" aria-hidden={k !== i} className={clsx("object-contain transition-[opacity,transform] duration-700 ease-out", k === i ? "scale-100 opacity-100" : "scale-[1.012] opacity-0")} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Caption, below the window so nothing covers the screen. */}
      <div key={t.key} className="hs-in mx-auto mt-8 flex max-w-4xl flex-col items-center gap-4 text-center sm:mt-10 md:flex-row md:justify-between md:text-left" style={{ "--at": "60ms" } as CSSProperties}>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-[0.14em] uppercase" style={{ color: `var(--p-${t.tone}-ink)` }}>{t.short}</p>
          <p className="mt-1.5 text-[clamp(1.2rem,2vw,1.5rem)] leading-snug font-medium tracking-[-0.025em] text-balance">{t.title}</p>
          <ul className="mt-2.5 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[13.5px] text-fg/60 md:justify-start">
            {t.points.map((pt) => (
              <li key={pt} className="flex items-center gap-1.5">
                <Check className="size-3.5" style={{ color: `var(--p-${t.tone}-ink)` }} strokeWidth={2.5} /> {pt}
              </li>
            ))}
          </ul>
        </div>
        <Link href={t.href} className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-5 text-[14px] font-semibold ring-1 ring-fg/[0.08] transition-shadow hover:shadow-md" style={{ background: `color-mix(in srgb, var(--p-${t.tone}) 75%, var(--surface-solid))`, color: `var(--p-${t.tone}-ink)` }}>
          Explore {t.cta} <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
