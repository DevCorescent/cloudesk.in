"use client";

// The homepage hero: the opening on matte black with the built-in features,
// then the main features as a 3D coverflow of real screens on a MacBook and
// an iPhone, moving on by itself until someone picks one. Pauses on hover;
// still for reduced motion.
import clsx from "clsx";
import { ArrowRight, BadgeIndianRupee, CalendarDays, Check, ChevronLeft, ChevronRight, Globe, Hammer, Inbox, LayoutDashboard, Mail, MessagesSquare, NotebookPen, ReceiptText, ShoppingBag, SlidersHorizontal, Sparkles, Store, Users, Zap } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { RiseWords, WordCycle } from "./interactive";
import { IPhone17 } from "./iphone";
import { MacBook } from "./macbook";
import type { Shot } from "./shot-tour";

// The AI onboarding loads only when it's opened.
const PublicAiMode = dynamic(() => import("@/components/ai-mode/public-ai").then((m) => m.PublicAiMode), { ssr: false });

const shot = (src: string, alt: string, w = 2880, h = 1800): Shot => ({ src: `/marketing/${src}.jpg`, w, h, alt });

/** The main features, each with a hookline, a real desktop screen and the same feature on a phone. */
const TRACKS = [
  {
    key: "website",
    icon: Globe,
    label: "Website",
    slug: "website-builder",
    hook: "Describe it. It's live.",
    line: "Say what you do in a sentence — get a polished, fast site you edit by dragging and clicking.",
    main: shot("builder/dragdrop", "The website builder: moving a section on the page with its drag handle"),
    phone: { src: "/marketing/phones/website-builder.jpg", alt: "A website made with the builder, on a phone" },
  },
  {
    key: "store",
    icon: ShoppingBag,
    label: "Online store",
    slug: "online-store",
    hook: "Open your store by dinner.",
    line: "Products, checkout, UPI and cards, orders and delivery — and the same stock at your counter.",
    main: shot("store/sf-home", "A storefront home page made with Cloudesk"),
    phone: { src: "/marketing/phones/online-store.jpg", alt: "The same storefront on a phone" },
  },
  {
    key: "software",
    icon: LayoutDashboard,
    label: "Business software",
    slug: "invoicing",
    hook: "Your whole business. One screen.",
    line: "CRM, invoices, accounts, HR and stock — switched on in minutes, and on one live dashboard.",
    main: shot("home/dashboard", "The business dashboard: money owed, pipeline, sales, team and stock at a glance"),
    phone: { src: "/marketing/phones/invoicing.jpg", alt: "Invoicing and money owed, on a phone" },
  },
  {
    key: "workday",
    icon: Inbox,
    label: "Your workday",
    slug: "my-work",
    hook: "Monday morning, already sorted.",
    line: "Your next meetings, what needs attention and what's waiting on you — the moment you sign in.",
    main: shot("workspace/home", "Home with your next meetings, what needs attention and what's waiting on you"),
    phone: { src: "/marketing/workspace/m-home.jpg", alt: "Home on a phone" },
  },
  {
    key: "mail",
    icon: Mail,
    label: "Mail",
    slug: "mail",
    hook: "Every inbox. Sorted before you look.",
    line: "Gmail, Outlook, Zoho or your own domain in one smart inbox — with phishing caught and invites ready to add.",
    main: shot("workspace/mail-meeting", "Mail: a meeting invite with Join, In your calendar and Going? Yes, Maybe, No"),
    phone: { src: "/marketing/workspace/m-mail.jpg", alt: "Mail on a phone" },
  },
  {
    key: "calendar",
    icon: CalendarDays,
    label: "Calendar",
    slug: "calendar",
    hook: "Never miss the meeting — or the minutes.",
    line: "Invites from your email, reminders through the day, and minutes you share when it's over.",
    main: shot("calendar/week", "The calendar week with meetings, an invite from email and minutes to write"),
    phone: { src: "/marketing/workspace/m-calendar.jpg", alt: "The calendar on a phone" },
  },
  {
    key: "chat",
    icon: MessagesSquare,
    label: "Chat",
    slug: "chat",
    hook: "Decide in the thread, not in a meeting.",
    line: "Channels and DMs with invoices shared as cards, approvals, decisions and polls — and AI catch-up.",
    main: shot("chat/channel", "A Chat channel with a quotation card, an approval and a decision"),
    phone: { src: "/marketing/workspace/m-chat.jpg", alt: "A chat channel on a phone" },
  },
  {
    key: "copilot",
    icon: Sparkles,
    label: "Insights",
    slug: "copilot",
    hook: "Your books, checked for you.",
    line: "Checks run over your numbers all the time — a bill entered twice, spending far above the usual — explained in plain words.",
    main: shot("copilot/checks", "Copilot checks: a possible duplicate supplier bill and a spending spike"),
    phone: { src: "/marketing/phones/reports.jpg", alt: "Reports and dashboards on a phone" },
  },
] as const;

const signup = (next: string, extra = "") => `/start?${extra}${extra ? "&" : ""}next=${encodeURIComponent(next)}`;
/** The two quick ways in above the headline: build (a website or a store, picked first) and the AI page. */
const QUICK = [
  { label: "Build now", icon: Hammer, href: signup("/launch") },
  { label: "Cloudesk AI", icon: Sparkles, href: "/intelligence" },
] as const;

/** What “Run your whole …” cycles through, each with its colour. */
const CYCLE = [
  { text: "business.", tone: "#ffffff" },
  { text: "store.", tone: "#fdba74" },
  { text: "website.", tone: "#a5b4fc" },
  { text: "sales.", tone: "#7dd3fc" },
  { text: "books.", tone: "#fde68a" },
  { text: "team.", tone: "#a7f3d0" },
  { text: "clinic.", tone: "#fda4af" },
];

/** The hero's row of built-in features, each linking to its page (tones read on the matte black). */
const BUILT_IN = [
  { slug: "mail", label: "Mail", icon: Mail, tone: "#8ab4ff" },
  { slug: "chat", label: "Chat", icon: MessagesSquare, tone: "#5eead4" },
  { slug: "calendar", label: "Calendar", icon: CalendarDays, tone: "#c4b5fd" },
  { slug: "notes", label: "Notes", icon: NotebookPen, tone: "#fcd34d" },
  { slug: "copilot", label: "Copilot", icon: Sparkles, tone: "#f0abfc" },
  { slug: "my-work", label: "My work", icon: Inbox, tone: "#fda4af" },
  { slug: "website-builder", label: "Website", icon: Globe, tone: "#93c5fd" },
  { slug: "online-store", label: "Store", icon: ShoppingBag, tone: "#fdba74" },
  { slug: "point-of-sale", label: "POS", icon: Store, tone: "#86efac" },
  { slug: "invoicing", label: "Invoicing", icon: ReceiptText, tone: "#fde68a" },
  { slug: "crm", label: "CRM", icon: Users, tone: "#7dd3fc" },
  { slug: "hrms", label: "HR & payroll", icon: BadgeIndianRupee, tone: "#a7f3d0" },
] as const;

const ROTATE_MS = 6000;

export function HomeHero() {
  // "Setup with AI" opens the same onboarding conversation as the phone intro's AI mode.
  const [ai, setAi] = useState(false);
  return (
    <section className="mk-hero mk-hero-light relative isolate overflow-hidden">
      <div aria-hidden className="mk-hero-mesh absolute inset-0 -z-10" />
      <div aria-hidden className="mk-hero-grid absolute inset-0 -z-10" />
      {/* The opening on matte black (its own --fg/--bg, so every colour inside flips), fading into the page below. */}
      <div className="mk-hero-matte mk-under-head relative isolate">
        <div aria-hidden className="mk-matte-glow absolute inset-0 -z-10" />
        <div className="mx-auto w-full max-w-[1600px] px-5 pt-12 pb-10 sm:px-8 sm:pt-16 sm:pb-14 lg:px-14 lg:pt-20 lg:pb-16 xl:px-20">
        {/* Two quick ways in, above the headline: sign up, then straight into the builder (as the phone intro does). */}
        <nav aria-label="Get started" className="hero-rise grid grid-cols-2 gap-2 max-[380px]:gap-1.5 sm:flex sm:flex-wrap">
          {QUICK.map((q) => (
            <Link key={q.label} href={q.href} className="hero-quick group inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-full py-1 pr-3.5 pl-1 text-[13px] font-medium max-[380px]:gap-1.5 max-[380px]:pr-2.5 max-[380px]:text-[12.5px] sm:h-9 sm:justify-start">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg/[0.08] text-fg/75 max-[380px]:size-6"><q.icon className="size-3.5" /></span>
              <span className="truncate">{q.label}</span>
              <ArrowRight className="size-3.5 shrink-0 text-fg/40 transition-transform group-hover:translate-x-0.5 group-hover:text-fg max-[380px]:hidden" />
            </Link>
          ))}
        </nav>
        {/* The headline: one row across the page, the intelligence in the logo's colours. */}
        {/* data-no-fit: the cycling word changes the width, so the one-line fitting would keep resizing it. */}
        <h1 data-no-fit className="mt-7 text-[clamp(2.35rem,5.4vw,5.6rem)] leading-[1.08] font-[340] tracking-[-0.045em] lg:mt-9">
          <RiseWords delay={60} parts={["Run your whole "]} />
          <span className="hero-rise" style={{ animationDelay: "240ms" }}><WordCycle words={CYCLE} delay={900} /></span>{" "}
          <RiseWords delay={320} parts={[{ text: "Intelligence built in.", className: "mk-logo-gradient" }]} />
        </h1>
        <div className="mt-8 grid gap-8 border-t border-fg/[0.08] pt-8 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16 lg:pt-10">
          {/* What's built in: each one opens its feature page. */}
          <nav aria-label="Built-in features" className="hero-rise min-w-0" style={{ animationDelay: "480ms" }}>
            <p className="text-[12px] font-medium tracking-[0.18em] text-fg/45 uppercase">Built in · one login</p>
            <ul className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-2.5">
              {BUILT_IN.map((f) => (
                <li key={f.slug}>
                  <Link href={`/features/${f.slug}`} className="group flex flex-col items-center gap-2 rounded-[16px] px-1 py-2.5 text-center transition-colors hover:bg-fg/[0.05]">
                    <span className="grid size-11 place-items-center rounded-[13px] bg-fg/[0.06] ring-1 ring-fg/[0.08] transition-[transform,background-color,box-shadow] duration-300 group-hover:-translate-y-0.5 group-hover:bg-fg/[0.1] group-hover:shadow-[0_10px_24px_-10px_var(--glow)]" style={{ ["--glow" as string]: f.tone }}>
                      <f.icon className="size-[19px]" style={{ color: f.tone }} strokeWidth={1.75} />
                    </span>
                    <span className="max-w-full truncate text-[12px] font-[450] text-fg/70 transition-colors group-hover:text-fg">{f.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="hero-rise grid gap-4 lg:justify-items-end" style={{ animationDelay: "580ms" }}>
            <div className="flex flex-col gap-5 sm:flex-row sm:gap-3">
              {/* Each way in carries how long it takes, as a badge on its corner. */}
              <span className="relative inline-flex flex-col">
                <Link href="/start" className="p-cta lx-sheen inline-flex h-[52px] items-center justify-center gap-2 px-8 text-[15px]">
                  Start free <ArrowRight className="size-4" />
                </Link>
                <span className="hero-badge hero-badge-mint"><SlidersHorizontal className="size-3" /> 5 min · Personalised</span>
              </span>
              <span className="relative inline-flex flex-col">
                {/* The in-app AI button's turning ring and glow (.ai-entry), on dark glass. */}
                <button type="button" onClick={() => setAi(true)} aria-haspopup="dialog" className="ai-entry hero-ai group inline-flex h-[52px] items-center justify-center gap-2.5 rounded-full pr-6 pl-2 text-[15px] font-medium">
                  {/* The face: above the glow, inside the turning ring. */}
                  <span aria-hidden className="hero-ai-face absolute inset-[1.25px] -z-[1] rounded-full" />
                  <span className="grid size-9 place-items-center rounded-full bg-white/[0.08]"><Sparkles className="ai-entry-ic size-4" strokeWidth={2.1} /></span> Setup with AI
                </button>
                <span className="hero-badge hero-badge-ai"><Zap className="size-3 fill-current" /> 2 min · Faster</span>
              </span>
            </div>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-fg/50 lg:justify-end">
              {["30-day free trial", "No card needed"].map((x) => (
                <li key={x} className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-400" /> {x}</li>
              ))}
            </ul>
          </div>
        </div>
        </div>
      </div>
      <div aria-hidden className="mk-matte-fade" />

      <FeatureFlow />
      {/* On the page body: the hero is its own stacking context, which would keep it under the site header. */}
      {ai && createPortal(<PublicAiMode onClose={() => setAi(false)} />, document.body)}
      <div aria-hidden className="mt-16 h-px bg-gradient-to-r from-transparent via-fg/10 to-transparent sm:mt-20" />
    </section>
  );
}

/** Which way and how far a slide sits from the one showing, wrapping round (−n/2 … n/2). */
const offset = (i: number, at: number, n: number) => ((i - at + n + Math.floor(n / 2)) % n) - Math.floor(n / 2);

/** The main features as a 3D coverflow: the one showing faces you on a MacBook with its
 *  iPhone in front, the next and previous turn away either side, and the whole stage lies
 *  back and straightens as it scrolls into view. Phones get a coverflow of iPhones. */
function FeatureFlow() {
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const n = TRACKS.length;
  const go = (k: number) => setAt((k + n) % n);
  useEffect(() => {
    if (paused || reduce) return;
    const t = setTimeout(() => setAt((at + 1) % n), ROTATE_MS);
    return () => clearTimeout(t);
  }, [at, paused, reduce, n]);
  // The scroll tilt: 1 while the stage is still low on the screen, 0 once it's well in view.
  useEffect(() => {
    const el = stage.current;
    if (!el || reduce) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.75)));
      el.style.setProperty("--tilt", (1 - p).toFixed(3));
    };
    const on = () => void (raf ||= requestAnimationFrame(update));
    update();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);
  const cur = TRACKS[at]!;
  const pick = (k: number) => (go(k), setPaused(true));
  const slide = (i: number) => {
    const d = offset(i, at, n);
    return { d, style: { "--d": d, "--ad": Math.abs(d), zIndex: 10 - Math.abs(d) } as CSSProperties, far: Math.abs(d) > 1 || undefined, side: d !== 0 || undefined };
  };
  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 pb-0 sm:px-8 lg:px-14 xl:px-20">
      <div
        className="relative -mt-14 sm:-mt-24 lg:-mt-28"
        role="region"
        aria-roledescription="carousel"
        aria-label="Cloudesk's main features"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") pick(at + 1);
          if (e.key === "ArrowLeft") pick(at - 1);
        }}
        onTouchStart={(e) => (touch.current = e.touches[0]!.clientX)}
        onTouchEnd={(e) => {
          if (touch.current === null) return;
          const dx = e.changedTouches[0]!.clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 40) pick(at + (dx < 0 ? 1 : -1));
        }}
      >
        {/* What's showing: the feature, its line, and the way in. */}
        <div className="grid items-end gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div key={`h-${at}`} className="mk-slide-in min-w-0 text-center sm:text-left">
            <p className="inline-flex items-center gap-2.5 text-[12px] font-medium tracking-[0.16em] text-fg/50 uppercase">
              <span className="grid size-7 place-items-center rounded-full bg-fg/[0.05] ring-1 ring-fg/[0.08]"><cur.icon className="size-3.5" strokeWidth={1.75} /></span>
              {cur.label}
              <span className="h-px w-6 bg-fg/20" />
              <span className="tabular-nums text-fg/40">{String(at + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
            </p>
            <p className="mt-4 text-[clamp(1.7rem,3.6vw,3.1rem)] leading-[1.08] font-[340] tracking-[-0.04em] text-balance">{cur.hook}</p>
            <p className="mx-auto mt-3 max-w-xl text-[15.5px] leading-relaxed font-[350] text-fg/55 sm:mx-0">{cur.line}</p>
          </div>
          <div className="flex items-center justify-center gap-2 sm:justify-end">
            <Link href={`/features/${cur.slug}`} className="group inline-flex h-10 items-center gap-1.5 rounded-full bg-fg px-4 text-[13.5px] font-medium text-bg transition-transform hover:scale-[1.02]">
              Explore {cur.label} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button type="button" aria-label="Previous feature" onClick={() => pick(at - 1)} className="grid size-10 place-items-center rounded-full text-fg/70 ring-1 ring-fg/[0.12] transition-colors hover:bg-fg/[0.04]"><ChevronLeft className="size-4" /></button>
            <button type="button" aria-label="Next feature" onClick={() => pick(at + 1)} className="grid size-10 place-items-center rounded-full text-fg/70 ring-1 ring-fg/[0.12] transition-colors hover:bg-fg/[0.04]"><ChevronRight className="size-4" /></button>
          </div>
        </div>

        <div ref={stage} className="ff-stage mt-10 sm:mt-14">
          <div aria-hidden className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[48px] bg-[radial-gradient(60%_60%_at_50%_30%,rgb(139_124_255/0.16),transparent_70%)] blur-2xl" />
          {/* Wide screens: MacBooks, with the iPhone in front of the one showing. */}
          <div className="ff-tilt hidden sm:block">
            <div className="ff-sizer mx-auto w-[74%]" aria-hidden><MacBook><span /></MacBook></div>
            {TRACKS.map((t, i) => {
              const s = slide(i);
              return (
                <div key={t.key} className="ff-slide w-[74%]" style={s.style} data-far={s.far} data-side={s.side} aria-hidden={s.d !== 0} onClick={s.d ? () => pick(i) : undefined}>
                  <MacBook>
                    <Image src={t.main.src} alt={t.main.alt} fill priority={i === 0} sizes="(min-width: 1600px) 1100px, 74vw" className="object-cover object-left-top" />
                  </MacBook>
                </div>
              );
            })}
            <div className="ff-floor" aria-hidden />
            <div className="pointer-events-none absolute right-[9%] bottom-[-6%] z-20 w-[12.5%] min-w-[120px]">
              {TRACKS.map((t, i) => (
                <div key={t.key} className={clsx("transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(.2,.8,.2,1)]", i === at ? "relative opacity-100" : "absolute inset-x-0 bottom-0 translate-y-6 opacity-0")} aria-hidden={i !== at}>
                  <IPhone17>
                    <Image src={t.phone.src} alt={t.phone.alt} fill sizes="200px" priority={i === 0} className="object-cover object-top" />
                  </IPhone17>
                </div>
              ))}
            </div>
          </div>
          {/* Phones: a coverflow of iPhones. */}
          <div className="ff-tilt ff-phone sm:hidden">
            <div className="ff-sizer mx-auto w-[min(60vw,260px)]" aria-hidden><IPhone17><span /></IPhone17></div>
            {TRACKS.map((t, i) => {
              const s = slide(i);
              return (
                <div key={t.key} className="ff-slide w-[min(60vw,260px)]" style={s.style} data-far={s.far} data-side={s.side} aria-hidden={s.d !== 0} onClick={s.d ? () => pick(i) : undefined}>
                  <IPhone17>
                    <Image src={t.phone.src} alt={t.phone.alt} fill sizes="60vw" priority={i === 0} className="object-cover object-top" />
                  </IPhone17>
                </div>
              );
            })}
          </div>
        </div>

        {/* Where you are: one labelled step per feature, the current one filling up. */}
        <div role="tablist" aria-label="Main features" className="mt-10 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:mt-14 sm:grid sm:grid-cols-8 sm:overflow-visible lg:mt-20">
          {TRACKS.map((t, i) => (
            <button key={t.key} type="button" role="tab" aria-selected={i === at} onClick={() => pick(i)} className={clsx("group shrink-0 text-left transition-colors sm:shrink", i === at ? "text-fg" : "text-fg/40 hover:text-fg/75")}>
              <span className="relative block h-[2px] w-24 overflow-hidden rounded-full bg-fg/[0.1] sm:w-auto">
                <span key={i === at ? `p-${at}-${paused}` : "x"} className={clsx("absolute inset-y-0 left-0 rounded-full bg-fg", i === at ? (paused || reduce ? "w-full" : "mk-hero-progress w-full") : i < at ? "w-full opacity-40" : "w-0")} style={i === at && !paused && !reduce ? { animationDuration: `${ROTATE_MS}ms` } : undefined} />
              </span>
              <span className="mt-2.5 flex items-center gap-1.5 truncate pr-2 text-[12.5px] font-medium"><t.icon className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
