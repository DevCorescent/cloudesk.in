"use client";

// The business-intelligence highlight on the homepage: six cards on a soft
// pastel panel, each with a real screen from the app, a small animated note
// on top of it, and what the feature does. On large screens they sit in a
// grid; on phones they become a swipeable slider that moves on by itself
// until you touch it. Animations only run while the section is on screen,
// and not at all for people who prefer reduced motion.
import clsx from "clsx";
import { ArrowRight, BellRing, Check, ChartColumnIncreasing, FileBarChart, MailCheck, MessageCircleQuestion, ScanSearch, Sparkles, TriangleAlert, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mark, Reveal } from "./interactive";
import { H2, W } from "./sections";

/* ───────── the notes that float over each screen ───────── */

const Chip = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={clsx("absolute rounded-[14px] bg-white/92 p-3 text-[12px] text-fg/80 shadow-[0_18px_40px_-18px_rgb(30_25_60/0.45)] ring-1 ring-fg/[0.06] backdrop-blur-md", className)}>{children}</div>
);

function ConnectsNote() {
  return (
    <Chip className="right-3 bottom-3 w-[150px]">
      <p className="text-[10.5px] text-fg/50">Collected this month</p>
      <p className="text-[17px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">₹41.9L</p>
      <div className="mt-2 flex h-9 items-end gap-1">
        {[40, 55, 48, 70, 62, 88].map((h, k) => <span key={k} className="bi-anim bi-bar flex-1 rounded-t-[3px] bg-[#7c6be0]" style={{ height: `${h}%`, animationDelay: `${k * 90}ms` }} />)}
      </div>
    </Chip>
  );
}

function WatchesNote() {
  const rows = [["#f97316", "₹4.15L overdue · 8 invoices", "Remind"], ["#eab308", "3 items below reorder level", "Reorder"]];
  return (
    <Chip className="right-3 bottom-3 left-3 grid gap-1.5 p-2 sm:left-auto sm:w-[230px]">
      {rows.map(([dot, text, tag], k) => (
        <p key={text} className="bi-anim bi-row flex items-center gap-2 rounded-[9px] bg-fg/[0.03] px-2 py-1.5" style={{ animationDelay: `${k * 450}ms` }}>
          <i className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} />
          <span className="min-w-0 flex-1 truncate">{text}</span>
          <span className="rounded-full bg-fg px-1.5 py-0.5 text-[9.5px] font-medium text-bg">{tag}</span>
        </p>
      ))}
    </Chip>
  );
}

function CatchesNote() {
  return (
    <Chip className="bi-anim bi-flag right-3 bottom-3 w-[200px]">
      <p className="flex items-center gap-1.5 font-semibold text-[#c2410c]"><TriangleAlert className="size-3.5" /> Possible duplicate</p>
      <p className="mt-1 leading-snug text-fg/60">Same supplier bill number as BL-0006. Worth a look before you pay.</p>
    </Chip>
  );
}

function AnswersNote() {
  return (
    <Chip className="right-3 bottom-3 left-3 grid gap-2 sm:left-auto sm:w-[240px]">
      <p className="ml-auto rounded-[12px] rounded-br-[4px] bg-fg px-2.5 py-1.5 text-bg">Who owes us the most?</p>
      <div className="relative">
        <span className="bi-anim bi-typing absolute top-0 left-0 inline-flex gap-1 rounded-[12px] rounded-bl-[4px] bg-[var(--p-lavender)] px-2.5 py-2.5">
          {[0, 1, 2].map((k) => <i key={k} className="size-1.5 rounded-full bg-fg/50" />)}
        </span>
        <p className="bi-anim bi-answer rounded-[12px] rounded-bl-[4px] bg-[var(--p-lavender)] px-2.5 py-1.5 leading-snug"><b className="font-semibold">Vikram Rao</b> — ₹10.9L, the oldest 64 days late. Send a reminder?</p>
      </div>
    </Chip>
  );
}

function ReportsNote() {
  return (
    <Chip className="right-3 bottom-3 w-[170px]">
      <div className="flex items-baseline justify-between">
        <p className="text-[16px] font-semibold tracking-[-0.02em] tabular-nums">₹9.64L</p>
        <span className="text-[10.5px] font-medium text-[#15803d]">▲ 12%</span>
      </div>
      <p className="text-[10.5px] text-fg/50">Revenue vs last month</p>
      <svg viewBox="0 0 100 30" className="mt-1.5 h-8 w-full" preserveAspectRatio="none" aria-hidden>
        <path d="M0 25 L14 21 L28 23 L42 16 L56 18 L70 11 L84 13 L100 4" pathLength={1} fill="none" stroke="#7c6be0" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" className="bi-anim bi-draw" />
      </svg>
    </Chip>
  );
}

function ScheduleNote() {
  return (
    <Chip className="bi-anim bi-badge right-3 bottom-3 flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--p-mint)]"><MailCheck className="size-4 text-[var(--p-mint-ink)]" /></span>
      <span><b className="block font-semibold">Scheduled</b><span className="text-fg/55">Every Monday, 9:00</span></span>
    </Chip>
  );
}

const CARDS: { icon: LucideIcon; tint: string; title: string; body: string; points: string[]; src: string; alt: string; pos: string; note: ReactNode }[] = [
  { icon: ChartColumnIncreasing, tint: "lavender", title: "Sees the whole picture", body: "Sales, invoices, payments, stock, hours and tickets join up the moment they happen.", points: ["Invoiced vs collected, by month", "Shop and online sales together", "No exports, no month-end stitching"], src: "/marketing/home/charts.jpg", alt: "Charts of invoiced and collected money, shop sales, pipeline and attendance", pos: "70% 0%", note: <ConnectsNote /> },
  { icon: BellRing, tint: "peach", title: "Tells you what needs you", body: "Each morning, your home screen leads with what's late, waiting or running low.", points: ["Overdue invoices, reminder ready", "Tickets past their response target", "Stock at its reorder level"], src: "/marketing/home/dashboard.jpg", alt: "The home screen listing what needs attention today", pos: "35% 100%", note: <WatchesNote /> },
  { icon: ScanSearch, tint: "rose", title: "Catches what you'd miss", body: "Checks run over your books all the time and explain each finding in plain words.", points: ["Supplier bills entered twice", "Spending far above the usual", "A lead to check, never an accusation"], src: "/marketing/copilot/checks.jpg", alt: "Copilot checks flagging a possible duplicate bill and a spending spike", pos: "45% 0%", note: <CatchesNote /> },
  { icon: MessageCircleQuestion, tint: "sky", title: "Answers in plain words", body: "Ask who owes you, what sold or who's off today — and let it do the next step.", points: ["Answers from your own data", "Limited to what your role can see", "Every action waits for your yes"], src: "/marketing/finance/overview.jpg", alt: "The finance overview: what you're owed, collected and overdue", pos: "75% 0%", note: <AnswersNote /> },
  { icon: FileBarChart, tint: "mint", title: "Dashboards you can trust", body: "Build a report over any module in a few clicks and pin it with KPIs against last period.", points: ["Profit & loss, balance sheet, GST", "KPIs vs the period before", "Export to CSV or Excel"], src: "/marketing/reports/dashboard.jpg", alt: "A sales dashboard with pipeline, revenue by product and orders by customer", pos: "65% 0%", note: <ReportsNote /> },
  { icon: Sparkles, tint: "butter", title: "Reports that send themselves", body: "Pick how often and who gets it; the numbers arrive in their inbox, on time, every time.", points: ["Daily, weekly or monthly", "Only what each person may see", "The top rows and a link to the rest"], src: "/marketing/reports/schedule.jpg", alt: "Scheduling a report to be emailed every Monday at 09:00", pos: "50% 45%", note: <ScheduleNote /> },
];

/* ───────── the section ───────── */

const AUTO_MS = 4500;

export function IntelligenceHighlight() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [at, setAt] = useState(0);
  const holdUntil = useRef(0);

  // Run the animations (and the slider) only while the section is on screen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setLive(!!e?.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Which card is showing, from the slider's scroll position.
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    const onScroll = () => {
      const cards = Array.from(t.children) as HTMLElement[];
      const left = t.scrollLeft;
      let best = 0;
      cards.forEach((c, k) => { if (Math.abs(c.offsetLeft - t.offsetLeft - left) < Math.abs(cards[best]!.offsetLeft - t.offsetLeft - left)) best = k; });
      setAt(best);
    };
    t.addEventListener("scroll", onScroll, { passive: true });
    return () => t.removeEventListener("scroll", onScroll);
  }, []);

  // On phones, move to the next card by itself; a touch holds it for a while.
  useEffect(() => {
    const t = track.current;
    if (!t || !live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      if (t.scrollWidth <= t.clientWidth + 4 || performance.now() < holdUntil.current) return;
      const cards = Array.from(t.children) as HTMLElement[];
      const next = cards[(at + 1) % cards.length]!;
      t.scrollTo({ left: next.offsetLeft - t.offsetLeft, behavior: "smooth" });
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [live, at]);

  // Event timestamps share performance.now()'s clock.
  const hold = (e: { timeStamp: number }) => { holdUntil.current = e.timeStamp + 9000; };
  const go = (e: { timeStamp: number }, k: number) => {
    const t = track.current;
    const c = t?.children[k] as HTMLElement | undefined;
    if (!t || !c) return;
    hold(e);
    t.scrollTo({ left: c.offsetLeft - t.offsetLeft, behavior: "smooth" });
  };

  return (
    <section ref={root} id="intelligence" data-live={live ? "1" : undefined} className={clsx(W, "bi-root scroll-mt-20 py-16 sm:py-24")}>
      <div className="bi-panel relative isolate overflow-hidden rounded-[32px] px-5 py-12 ring-1 ring-fg/[0.05] sm:rounded-[40px] sm:px-10 sm:py-16 lg:px-14 lg:py-20">
        <div aria-hidden className="bi-blob bi-blob-a absolute -top-32 -left-24 -z-10 size-[420px] rounded-full" />
        <div aria-hidden className="bi-blob bi-blob-b absolute top-1/3 -right-32 -z-10 size-[460px] rounded-full" />
        <div aria-hidden className="bi-blob bi-blob-c absolute -bottom-40 left-1/3 -z-10 size-[420px] rounded-full" />
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3.5 py-1.5 text-[12.5px] font-medium text-fg/65 ring-1 ring-fg/[0.07] backdrop-blur">
            <Sparkles className="size-3.5 text-[var(--tint-lavender-ink)]" /> Business intelligence, built in
          </p>
          <h2 className={clsx(H2, "mt-5")}>Software that runs your business. <Mark tone="lavender">Intelligence that reads it.</Mark></h2>
          <p className="mx-auto mt-5 max-w-xl text-[16.5px] leading-relaxed text-fg/58">Because every part of your business lives in one place, Cloudesk sees the whole picture — and turns it into what to do next.</p>
        </Reveal>

        <div
          ref={track}
          onPointerDown={hold}
          onTouchStart={hold}
          onWheel={hold}
          className="-mx-5 mt-12 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pt-1 pb-3 [scrollbar-width:none] sm:-mx-10 sm:scroll-px-10 sm:px-10 lg:mx-0 lg:mt-14 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
          aria-label="What Cloudesk's intelligence does"
        >
          {CARDS.map((c, k) => (
            <Reveal key={c.title} delay={(k % 3) * 80} className="w-[86%] shrink-0 snap-start sm:w-[56%] md:w-[44%] lg:w-auto">
              <article className="bi-card group flex h-full flex-col overflow-hidden rounded-[24px]">
                <div className="relative m-2 aspect-[16/11] overflow-hidden rounded-[18px] bg-white ring-1 ring-fg/[0.06]">
                  <div className="bi-anim bi-pan absolute inset-0" style={{ animationDelay: `${k * -1.7}s` }}>
                    <Image src={c.src} alt={c.alt} fill sizes="(min-width: 1024px) 30vw, 86vw" className="object-cover" style={{ objectPosition: c.pos }} />
                  </div>
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-white/50 to-transparent" />
                  {c.note}
                </div>
                <div className="flex flex-1 flex-col p-5 pt-4 sm:p-6 sm:pt-4">
                  <p className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.015em]">
                    <span className={clsx("tint-chip grid size-8 place-items-center rounded-[10px]", `tint-${c.tint}`)}><c.icon className="size-4" /></span>
                    {c.title}
                  </p>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-fg/60">{c.body}</p>
                  <ul className="mt-4 grid gap-1.5 border-t border-fg/[0.06] pt-4">
                    {c.points.map((p) => (
                      <li key={p} className="flex gap-2 text-[13.5px] text-fg/65"><Check className="mt-0.5 size-3.5 shrink-0 text-[var(--p-mint-ink)]" />{p}</li>
                    ))}
                  </ul>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <div className="mt-5 flex justify-center gap-1.5 lg:hidden">
          {CARDS.map((c, k) => (
            <button key={c.title} type="button" onClick={(e) => go(e, k)} aria-label={`Show “${c.title}”`} aria-current={k === at} className="grid h-6 place-items-center px-0.5">
              <span className={clsx("block h-1.5 rounded-full transition-all duration-500", k === at ? "w-6 bg-fg" : "w-1.5 bg-fg/20")} />
            </button>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row lg:mt-14">
          <Link href="/start" className="p-cta lx-sheen inline-flex h-12 items-center gap-2 px-7 text-[15px]">Start free <ArrowRight className="size-4" /></Link>
          <Link href="/features/copilot" className="inline-flex h-12 items-center rounded-full bg-white/60 px-6 text-[14.5px] font-medium text-fg/80 ring-1 ring-fg/[0.1] backdrop-blur transition-colors hover:bg-white hover:text-fg">Meet the copilot</Link>
        </div>
      </div>
    </section>
  );
}
