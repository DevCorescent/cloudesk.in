"use client";

// The homepage's moving parts: the hero (three things you can launch — a
// website, a store, your business software — each shown with a real screen
// from the app, changing by itself until someone picks one), and the
// product switcher further down. Pauses on hover; still for reduced motion.
import clsx from "clsx";
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Globe, Inbox, LayoutDashboard, Mail, MessagesSquare, Play, ShoppingBag, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RiseWords } from "./interactive";
import { PhoneFrame } from "./phone-deck";
import { ShotFrame, type Shot } from "./shot-tour";

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
    label: "Copilot",
    slug: "copilot",
    hook: "Ask your business anything.",
    line: "Plain-language questions answered from your own numbers — sales, dues, stock and people.",
    main: shot("workspace/copilot", "Ask Copilot: ask about sales, dues, stock or people"),
    phone: { src: "/marketing/workspace/m-copilot.jpg", alt: "Copilot on a phone" },
  },
] as const;

const ROTATE_MS = 6000;

export function HomeHero() {
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
  const ref = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const go = (n: number) => setAt((n + TRACKS.length) % TRACKS.length);
  useEffect(() => {
    if (paused || reduce) return;
    const t = setTimeout(() => setAt((at + 1) % TRACKS.length), ROTATE_MS);
    return () => clearTimeout(t);
  }, [at, paused, reduce]);
  const cur = TRACKS[at]!;
  return (
    <section className="mk-hero mk-hero-light relative isolate overflow-hidden">
      <div aria-hidden className="mk-hero-mesh absolute inset-0 -z-10" />
      <div aria-hidden className="mk-hero-grid absolute inset-0 -z-10" />
      <div className="mx-auto w-full max-w-[1600px] px-5 pt-12 pb-0 sm:px-8 sm:pt-16 lg:px-14 lg:pt-20 xl:px-20">
        <Link href="/features/chat" className="hero-rise group inline-flex items-center gap-2 rounded-full bg-fg/[0.04] py-1 pr-3.5 pl-1 text-[12.5px] text-fg/65 ring-1 ring-fg/[0.08] transition-colors hover:bg-fg/[0.07] hover:text-fg">
          <span className="rounded-full bg-fg px-2 py-0.5 text-[10.5px] font-medium tracking-[0.06em] text-bg uppercase">New</span>
          Chat, Calendar and Mail — one workspace for the whole team <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
        {/* The headline: one row across the page, the promise in the logo's colours. */}
        <h1 className="mt-7 text-[clamp(2.35rem,5.4vw,5.6rem)] leading-[1.08] font-[340] tracking-[-0.045em] lg:mt-9">
          <RiseWords delay={60} parts={["Your website, store and business software. ", { text: "Ready in minutes.", className: "mk-logo-gradient" }]} />
        </h1>
        <div className="mt-8 grid gap-8 border-t border-fg/[0.08] pt-8 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16 lg:pt-10">
          <p className="hero-rise max-w-2xl text-[17px] leading-relaxed font-[350] text-pretty text-fg/62 sm:text-[19px]" style={{ animationDelay: "480ms" }}>
            Cloudesk builds your site, opens your online store and switches on the software you run the business with — sales, money, people and stock — on one platform, in one login.
          </p>
          <div className="hero-rise grid gap-4 lg:justify-items-end" style={{ animationDelay: "580ms" }}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/start" className="p-cta lx-sheen inline-flex h-[52px] items-center justify-center gap-2 px-8 text-[15px]">
                Start free <ArrowRight className="size-4" />
              </Link>
              <Link href="/features/launch" className="group inline-flex h-[52px] items-center justify-center gap-2.5 rounded-full pr-6 pl-2 text-[15px] font-medium text-fg ring-1 ring-fg/[0.12] transition-colors hover:bg-fg/[0.04]">
                <span className="grid size-9 place-items-center rounded-full bg-fg/[0.06] transition-colors group-hover:bg-fg/[0.1]"><Play className="size-3.5 translate-x-px fill-current" /></span> See how a launch works
              </Link>
            </div>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-fg/50 lg:justify-end">
              {["No card needed", "GST invoices & UPI", "Your data exports any time"].map((x) => (
                <li key={x} className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600" /> {x}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* The main features: a hookline and the real screens for each, moving on by itself. */}
        <div
          className="mt-14 sm:mt-20 lg:mt-24"
          ref={ref}
          role="region"
          aria-roledescription="carousel"
          aria-label="Cloudesk's main features"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(at + 1);
            if (e.key === "ArrowLeft") go(at - 1);
          }}
          onTouchStart={(e) => (touch.current = e.touches[0]!.clientX)}
          onTouchEnd={(e) => {
            if (touch.current === null) return;
            const dx = e.changedTouches[0]!.clientX - touch.current;
            touch.current = null;
            if (Math.abs(dx) > 40) go(at + (dx < 0 ? 1 : -1));
          }}
        >
          {/* The hookline */}
          <div className="grid items-end gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div key={`h-${at}`} className="mk-slide-in min-w-0 text-center sm:text-left">
              <p className="inline-flex items-center gap-2 text-[12px] font-medium tracking-[0.18em] text-fg/45 uppercase">
                <cur.icon className="size-3.5" strokeWidth={1.75} /> {cur.label}
                <span className="text-fg/25">·</span>
                <span className="tabular-nums">{String(at + 1).padStart(2, "0")} / {String(TRACKS.length).padStart(2, "0")}</span>
              </p>
              <p data-fit className="mt-3 text-[clamp(1.6rem,3.4vw,2.9rem)] leading-[1.1] font-[360] tracking-[-0.035em] text-balance">{cur.hook}</p>
              <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed font-[350] text-fg/55 sm:mx-0">{cur.line}</p>
            </div>
            <div className="flex items-center justify-center gap-2 sm:justify-end">
              <Link href={`/features/${cur.slug}`} className="group inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium text-fg ring-1 ring-fg/[0.12] transition-colors hover:bg-fg/[0.04]">
                Explore {cur.label} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <button type="button" aria-label="Previous feature" onClick={() => (go(at - 1), setPaused(true))} className="grid size-10 place-items-center rounded-full text-fg/70 ring-1 ring-fg/[0.12] transition-colors hover:bg-fg/[0.04]"><ChevronLeft className="size-4" /></button>
              <button type="button" aria-label="Next feature" onClick={() => (go(at + 1), setPaused(true))} className="grid size-10 place-items-center rounded-full text-fg/70 ring-1 ring-fg/[0.12] transition-colors hover:bg-fg/[0.04]"><ChevronRight className="size-4" /></button>
            </div>
          </div>

          {/* The screens: desktop with the phone in front; on a phone, the app's own mobile screens. */}
          <div className="relative mt-8 sm:mt-10">
            <div aria-hidden className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[48px] bg-[radial-gradient(60%_60%_at_50%_30%,rgb(139_124_255/0.14),transparent_70%)] blur-2xl" />
            <div className="relative hidden sm:block">
              {TRACKS.map((t, i) => (
                <div key={t.key} className={clsx("transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(.2,.8,.2,1)]", i === at ? "relative opacity-100" : "pointer-events-none absolute inset-0 translate-y-4 scale-[0.985] opacity-0 blur-[3px]")} aria-hidden={i !== at}>
                  <ShotFrame shot={t.main} url={`cloudesk · ${t.label}`} priority={i === 0} sizes="(min-width: 1600px) 1460px, 100vw" />
                </div>
              ))}
            </div>
            {/* The phone in front (wide screens) */}
            <div className="pointer-events-none absolute right-[3%] bottom-[-7%] hidden w-[15%] min-w-[150px] lg:block">
              {TRACKS.map((t, i) => (
                <div key={t.key} className={clsx("transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(.2,.8,.2,1)] drop-shadow-[0_40px_50px_rgb(0_0_0/0.55)]", i === at ? "relative opacity-100" : "absolute inset-x-0 bottom-0 translate-y-6 opacity-0")} aria-hidden={i !== at}>
                  <PhoneFrame src={t.phone.src} alt={t.phone.alt} priority={i === 0} />
                </div>
              ))}
            </div>
            {/* On a phone: the mobile app itself */}
            <div className="relative mx-auto w-[min(72vw,300px)] sm:hidden">
              {TRACKS.map((t, i) => (
                <div key={t.key} className={clsx("transition-[opacity,transform] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]", i === at ? "relative opacity-100" : "pointer-events-none absolute inset-0 translate-x-6 opacity-0")} aria-hidden={i !== at}>
                  <PhoneFrame src={t.phone.src} alt={t.phone.alt} priority={i === 0} />
                </div>
              ))}
            </div>
          </div>

          {/* Where you are: one labelled step per feature, the current one filling up. */}
          <div role="tablist" aria-label="Main features" className="mt-6 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:mt-8 lg:mt-20 sm:grid sm:grid-cols-8 sm:overflow-visible">
            {TRACKS.map((t, i) => (
              <button key={t.key} type="button" role="tab" aria-selected={i === at} onClick={() => (setAt(i), setPaused(true))} className={clsx("group shrink-0 text-left transition-colors sm:shrink", i === at ? "text-fg" : "text-fg/40 hover:text-fg/75")}>
                <span className="relative block h-[2px] w-24 overflow-hidden rounded-full bg-fg/[0.1] sm:w-auto">
                  <span key={i === at ? `p-${at}-${paused}` : "x"} className={clsx("absolute inset-y-0 left-0 rounded-full bg-fg", i === at ? (paused || reduce ? "w-full" : "mk-hero-progress w-full") : i < at ? "w-full opacity-40" : "w-0")} style={i === at && !paused && !reduce ? { animationDuration: `${ROTATE_MS}ms` } : undefined} />
                </span>
                <span className="mt-2.5 block truncate pr-2 text-[12.5px] font-medium">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div aria-hidden className="mt-16 h-px bg-gradient-to-r from-transparent via-fg/10 to-transparent sm:mt-20" />
    </section>
  );
}

// ── Your workday: the five things you open every day, with real screens ─────

const DAY = [
  { key: "home", phone: "/marketing/workspace/m-home.jpg", icon: LayoutDashboard, label: "Home", slug: "my-work", title: "Your day, the moment you sign in.", body: "Your next meetings with a Join button, what needs attention and what's waiting on you — with unread counts for Mail, Calendar and Chat in the sidebar.", points: ["Up next from your calendar", "Needs attention, across every feature", "Live unread counts"], shot: shot("workspace/home", "Home: Up next meetings, needs attention and waiting on you") },
  { key: "my-work", phone: "/marketing/workspace/m-my-work.jpg", icon: Inbox, label: "My work", slug: "my-work", title: "Everything waiting on you, in one list.", body: "Approvals, tasks, follow-ups and reminders from every feature you use — overdue first, one click to act.", points: ["Approve or reject in place", "Tasks and CRM follow-ups due", "Reminders and stand-ins while you're away"], shot: shot("workspace/my-work", "My work: an overdue task, today's tasks and reminders") },
  { key: "mail", phone: "/marketing/workspace/m-mail.jpg", icon: Mail, label: "Mail", slug: "mail", title: "Every mailbox, sorted before you look.", body: "Gmail, Outlook, Zoho or your own domain in one inbox — sorted, screened for phishing, with meeting invites ready to add and the customer beside their email.", points: ["Smart categories and a screener", "Any email → a note, a meeting, a task or a chat", "Recurring emails that run themselves"], shot: shot("workspace/mail-meeting", "Mail: a meeting invite with Join, In your calendar and Going? Yes, Maybe, No") },
  { key: "calendar", phone: "/marketing/workspace/m-calendar.jpg", icon: CalendarDays, label: "Calendar", slug: "calendar", title: "Meetings, from invite to minutes.", body: "Invites and meeting links from your email, reminders through the day, and the minutes you share when it's over.", points: ["Day, week, month and agenda", "Invites found in your email", "Minutes of meeting, shared by email"], shot: shot("calendar/week", "The calendar week with meetings, an invite from email and minutes to write") },
  { key: "chat", phone: "/marketing/workspace/m-chat.jpg", icon: MessagesSquare, label: "Chat", slug: "chat", title: "Team chat, with the work in it.", body: "Channels, threads and direct messages — with invoices and deals shared as cards, approvals, decisions and polls in the conversation.", points: ["Records shared as live cards", "Approvals and decisions in place", "AI catch-up on what you missed"], shot: shot("chat/channel", "A Chat channel with a quotation card, an approval and a decision") },
  { key: "copilot", phone: "/marketing/workspace/m-copilot.jpg", icon: Sparkles, label: "Copilot", slug: "copilot", title: "Ask your business anything.", body: "Questions in plain words, answered from your own numbers — sales, dues, stock, people — with the figures it used.", points: ["Answers from your own data", "Checks that run by themselves", "Respects each person's access"], shot: shot("workspace/copilot", "Ask Copilot: ask about sales, dues, stock or people") },
] as const;

const DAY_MS = 7000;

export function WorkdaySection() {
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
  useEffect(() => {
    if (paused || reduce) return;
    const t = setTimeout(() => setAt((at + 1) % DAY.length), DAY_MS);
    return () => clearTimeout(t);
  }, [at, paused, reduce]);
  const cur = DAY[at]!;
  return (
    <section id="workday" className="relative py-20 sm:py-28" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-14 xl:px-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[12px] font-medium tracking-[0.22em] text-fg/45 uppercase">Your workday</p>
          <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.8rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">
            <RiseWords parts={["Everything you open all day. ", { text: "One calm workspace.", className: "text-fg/45" }]} />
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16.5px] leading-relaxed font-[350] text-fg/60">Home, My work, Mail, Calendar, Chat and Copilot — built together, so a meeting in your email is in your calendar, an invoice can be shared in chat, and nothing waiting on you gets lost.</p>
        </div>
        <div role="tablist" aria-label="Your workday" className="mx-auto mt-10 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-fg/[0.04] p-1 ring-1 ring-fg/[0.06] [scrollbar-width:none]">
          {DAY.map((d, i) => {
            const Icon = d.icon;
            return (
              <button key={d.key} type="button" role="tab" aria-selected={i === at} onClick={() => (setAt(i), setPaused(true))} className={clsx("relative inline-flex h-10 shrink-0 items-center gap-2 overflow-hidden rounded-full px-4 text-[13.5px] transition-[background,color,box-shadow] duration-300", i === at ? "bg-[var(--p-canvas)] text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06),0_4px_14px_-6px_rgb(20_20_40/0.18)]" : "text-fg/55 hover:text-fg")}>
                <Icon className="size-4" strokeWidth={1.75} /> {d.label}
                {i === at && !paused && !reduce && <span key={at} aria-hidden className="mk-hero-progress absolute inset-x-4 bottom-1 h-[1.5px] origin-left rounded-full bg-fg/25" style={{ animationDuration: `${DAY_MS}ms` }} />}
              </button>
            );
          })}
        </div>
        <div className="mt-10 grid items-center gap-8 lg:mt-14 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-14">
          <div key={`t-${cur.key}`} className="mk-menu-in">
            <h3 className="text-[clamp(1.5rem,2.4vw,2.1rem)] leading-[1.12] font-[420] tracking-[-0.03em] text-balance">{cur.title}</h3>
            <p className="mt-4 text-[15.5px] leading-relaxed font-[350] text-fg/62">{cur.body}</p>
            <ul className="mt-6 grid gap-2.5">
              {cur.points.map((p) => <li key={p} className="flex items-center gap-2.5 text-[14.5px] text-fg/75"><span className="grid size-5 place-items-center rounded-full bg-fg/[0.06]"><Check className="size-3" strokeWidth={2.5} /></span>{p}</li>)}
            </ul>
            <Link href={`/features/${cur.slug}`} className="group mt-8 inline-flex items-center gap-1.5 text-[14.5px] font-medium text-fg">
              Explore {cur.label === "Home" ? "My work" : cur.label} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          <div className="relative">
            <div aria-hidden className="absolute -inset-6 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_60%_40%,rgb(139_124_255/0.16),transparent_70%)] blur-2xl" />
            <div className="relative hidden sm:block">
              {DAY.map((d, i) => (
                <div key={d.key} className={clsx("transition-[opacity,transform,filter] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]", i === at ? "relative opacity-100" : "pointer-events-none absolute inset-0 translate-y-2 opacity-0 blur-[2px]")} aria-hidden={i !== at}>
                  <ShotFrame shot={d.shot} url={`cloudesk · ${d.label}`} sizes="(min-width: 1280px) 1000px, 100vw" />
                </div>
              ))}
            </div>
            {/* On a phone, the app as it looks on a phone. */}
            <div className="relative mx-auto w-[min(70vw,290px)] sm:hidden">
              {DAY.map((d, i) => (
                <div key={d.key} className={clsx("transition-[opacity,transform] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]", i === at ? "relative opacity-100" : "pointer-events-none absolute inset-0 translate-x-5 opacity-0")} aria-hidden={i !== at}>
                  <PhoneFrame src={d.phone} alt={`${d.label} on a phone`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
