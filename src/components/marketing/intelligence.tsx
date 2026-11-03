"use client";

// The business-intelligence highlight on the homepage: six wide cards in a
// horizontal scroller on a soft pastel panel. Each card pairs what the
// feature does with a real screen in a different device — a MacBook, an
// iPhone, a browser window tilted in 3D, an iPad, a mail window — and a
// small animated note on top. On large screens the section pins while you
// scroll and the cards glide sideways; on phones and with reduced motion
// it's a swipeable row that moves on by itself until touched. Animations
// only run while the section is on screen.
import clsx from "clsx";
import { ArrowRight, BellRing, Check, ChartColumnIncreasing, ChevronLeft, ChevronRight, FileBarChart, MailCheck, MessageCircleQuestion, ScanSearch, Sparkles, TriangleAlert, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Tint } from "@/lib/workspace/modules";
import { Mark, Reveal } from "./interactive";
import { IPhone17 } from "./iphone";
import { MacBook } from "./macbook";
import { H2, W } from "./sections";

/* ───────── the notes that float over each device ───────── */

const Chip = ({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) => (
  <div className={clsx("absolute z-10 rounded-[14px] bg-white/92 p-3 text-[12px] text-fg/80 shadow-[0_18px_40px_-18px_rgb(30_25_60/0.45)] ring-1 ring-fg/[0.06] backdrop-blur-md", className)} style={style}>{children}</div>
);

function ConnectsNote() {
  return (
    <Chip className="right-[4%] bottom-[10%] w-[150px]">
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
    <Chip className="bottom-[12%] left-[4%] grid w-[230px] gap-1.5 p-2">
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
    <Chip className="bi-anim bi-flag right-[5%] bottom-[12%] w-[210px]">
      <p className="flex items-center gap-1.5 font-semibold text-[#c2410c]"><TriangleAlert className="size-3.5" /> Possible duplicate</p>
      <p className="mt-1 leading-snug text-fg/60">Same supplier bill number as BL-0006. Worth a look before you pay.</p>
    </Chip>
  );
}

function AnswersNote() {
  return (
    <Chip className="bottom-[14%] left-[4%] grid w-[230px] gap-2">
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
    <Chip className="top-[10%] right-[4%] w-[170px]">
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
    <Chip className="bi-anim bi-badge top-[8%] right-[6%] flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--p-mint)]"><MailCheck className="size-4 text-[var(--p-mint-ink)]" /></span>
      <span><b className="block font-semibold">Scheduled</b><span className="text-fg/55">Every Monday, 9:00</span></span>
    </Chip>
  );
}

/* ───────── the devices ───────── */

const shot = (src: string, alt: string, pos = "0% 0%") => <Image src={`/marketing/${src}.jpg`} alt={alt} fill sizes="(min-width: 1024px) 40vw, 80vw" className="bi-anim bi-pan object-cover" style={{ objectPosition: pos }} />;

/** A browser window, turned a little in 3D. */
function Browser({ children, url }: { children: ReactNode; url: string }) {
  return (
    <div className="bi-tilt w-[86%] overflow-hidden rounded-[14px] bg-white shadow-[0_40px_80px_-36px_rgb(30_25_60/0.55)] ring-1 ring-fg/[0.08]">
      <div className="flex h-7 items-center gap-1.5 border-b border-fg/[0.06] px-3">
        <i className="size-2 rounded-full bg-[#ff5f57]" />
        <i className="size-2 rounded-full bg-[#febc2e]" />
        <i className="size-2 rounded-full bg-[#28c840]" />
        <span className="mx-auto rounded-full bg-fg/[0.05] px-2.5 py-0.5 text-[9.5px] text-fg/45">{url}</span>
      </div>
      <div className="relative aspect-[16/10] overflow-hidden">{children}</div>
    </div>
  );
}

/** An iPad in landscape: a thin black border in a rounded aluminium edge. */
function Tablet({ children }: { children: ReactNode }) {
  return (
    <div className="w-[86%] rounded-[5.2%/7.4%] bg-gradient-to-br from-[#d9dade] via-[#b8bac0] to-[#9a9ca3] p-[0.6%] shadow-[0_40px_80px_-36px_rgb(30_25_60/0.55)]">
      <div className="rounded-[4.8%/6.9%] bg-[#0b0b0d] p-[2.4%]">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[2.2%/3.4%] bg-white">{children}</div>
      </div>
    </div>
  );
}

/** A mail window: the report as it lands in someone's inbox. */
function MailWindow({ children }: { children: ReactNode }) {
  return (
    <div className="w-[88%] overflow-hidden rounded-[16px] bg-white shadow-[0_40px_80px_-36px_rgb(30_25_60/0.55)] ring-1 ring-fg/[0.08]">
      <div className="flex items-center gap-3 border-b border-fg/[0.06] px-4 py-2.5">
        <span className="grid size-7 place-items-center rounded-full bg-[var(--p-butter)] text-[11px] font-semibold text-[var(--p-butter-ink)]">CD</span>
        <span className="min-w-0 flex-1 text-[11px] leading-tight">
          <b className="block truncate font-semibold text-fg/85">Weekly sales report — Monday 9:00</b>
          <span className="block truncate text-fg/45">Cloudesk Reports · to Ananya Rao</span>
        </span>
        <span className="text-[10px] text-fg/40">9:00</span>
      </div>
      <div className="relative aspect-[16/9] overflow-hidden">{children}</div>
    </div>
  );
}

const Phone = ({ src, alt }: { src: string; alt: string }) => (
  <div className="w-[34%] max-w-[210px] drop-shadow-[0_30px_40px_rgb(30_25_60/0.35)]">
    <IPhone17>
      <Image src={`/marketing/${src}.jpg`} alt={alt} fill sizes="210px" className="object-cover object-top" />
    </IPhone17>
  </div>
);

type Card = { icon: LucideIcon; tint: Tint; title: string; body: string; points: string[]; device: ReactNode; note: ReactNode };
const CARDS: Card[] = [
  { icon: ChartColumnIncreasing, tint: "lavender", title: "Sees the whole picture", body: "Sales, invoices, payments, stock, hours and tickets join up the moment they happen.", points: ["Invoiced vs collected, by month", "Shop and online sales together", "No exports, no month-end stitching"], device: <div className="w-[92%]"><MacBook>{shot("home/charts", "Charts of invoiced and collected money, shop sales, pipeline and attendance", "60% 0%")}</MacBook></div>, note: <ConnectsNote /> },
  { icon: BellRing, tint: "peach", title: "Tells you what needs you", body: "Each morning, your home screen leads with what's late, waiting or running low.", points: ["Overdue invoices, reminder ready", "Tickets past their response target", "Stock at its reorder level"], device: <Phone src="workspace/m-home" alt="Home on a phone, with what needs attention today" />, note: <WatchesNote /> },
  { icon: ScanSearch, tint: "rose", title: "Catches what you'd miss", body: "Checks run over your books all the time and explain each finding in plain words.", points: ["Supplier bills entered twice", "Spending far above the usual", "A lead to check, never an accusation"], device: <Browser url="app.cloudesk.in/copilot/checks">{shot("copilot/checks", "Copilot checks flagging a possible duplicate bill and a spending spike", "45% 0%")}</Browser>, note: <CatchesNote /> },
  { icon: MessageCircleQuestion, tint: "sky", title: "Answers in plain words", body: "Ask who owes you, what sold or who's off today — and let it do the next step.", points: ["Answers from your own data", "Limited to what your role can see", "Every action waits for your yes"], device: <Phone src="phones/invoicing" alt="What you're owed, collected and overdue, on a phone" />, note: <AnswersNote /> },
  { icon: FileBarChart, tint: "mint", title: "Dashboards you can trust", body: "Build a report over any module in a few clicks and pin it with KPIs against last period.", points: ["Profit & loss, balance sheet, GST", "KPIs vs the period before", "Export to CSV or Excel"], device: <Tablet>{shot("reports/builder", "Building a report: deals grouped by stage, shown as bars", "60% 0%")}</Tablet>, note: <ReportsNote /> },
  { icon: Sparkles, tint: "butter", title: "Reports that send themselves", body: "Pick how often and who gets it; the numbers arrive in their inbox, on time, every time.", points: ["Daily, weekly or monthly", "Only what each person may see", "The top rows and a link to the rest"], device: <MailWindow>{shot("reports/dashboard", "The weekly sales report, as it arrives by email", "40% 30%")}</MailWindow>, note: <ScheduleNote /> },
];

/* ───────── the section ───────── */

const AUTO_MS = 4800;
const PIN = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

export function IntelligenceHighlight() {
  const root = useRef<HTMLElement>(null);
  const pinBox = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState(0);
  const holdUntil = useRef(0);
  const n = CARDS.length;

  // Animations (and the phone slider) run only while the section is on screen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setLive(!!e?.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Large screens: pin the section and turn vertical scroll into sideways travel.
  useEffect(() => {
    const mq = window.matchMedia(PIN);
    const sync = () => setPinned(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const box = pinBox.current;
    const t = track.current;
    if (!pinned || !box || !t) return;
    let raf = 0;
    const measure = () => {
      // Up to the last card's right edge plus the same gutter it started with (scrollWidth leaves out the end padding).
      const last = t.lastElementChild as HTMLElement | null;
      const gutter = parseFloat(getComputedStyle(t).paddingLeft) || 0;
      const travel = last ? Math.max(0, last.offsetLeft + last.offsetWidth + gutter - t.clientWidth) : 0;
      box.style.height = `${innerHeight + travel}px`;
      box.dataset.travel = String(travel);
    };
    const update = () => {
      raf = 0;
      const travel = Number(box.dataset.travel || 0);
      const p = Math.min(1, Math.max(0, -box.getBoundingClientRect().top / Math.max(1, travel)));
      t.style.transform = `translate3d(${-p * travel}px,0,0)`;
      box.style.setProperty("--p", p.toFixed(4));
      setAt(Math.round(p * (n - 1)));
    };
    const on = () => void (raf ||= requestAnimationFrame(update));
    const onResize = () => (measure(), on());
    measure();
    update();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", onResize);
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      box.style.height = "";
      t.style.transform = "";
    };
  }, [pinned, n]);

  // Otherwise: a swipeable row; which card is showing comes from its scroll position.
  useEffect(() => {
    const t = track.current;
    if (!t || pinned) return;
    const onScroll = () => {
      const cards = Array.from(t.children) as HTMLElement[];
      let best = 0;
      cards.forEach((c, k) => { if (Math.abs(c.offsetLeft - t.offsetLeft - t.scrollLeft) < Math.abs(cards[best]!.offsetLeft - t.offsetLeft - t.scrollLeft)) best = k; });
      setAt(best);
    };
    t.addEventListener("scroll", onScroll, { passive: true });
    return () => t.removeEventListener("scroll", onScroll);
  }, [pinned]);
  // …which moves on by itself; a touch holds it for a while.
  useEffect(() => {
    const t = track.current;
    if (!t || pinned || !live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      if (performance.now() < holdUntil.current) return;
      const next = t.children[(at + 1) % n] as HTMLElement | undefined;
      if (next) t.scrollTo({ left: next.offsetLeft - t.offsetLeft, behavior: "smooth" });
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [pinned, live, at, n]);

  // Event timestamps share performance.now()'s clock.
  const hold = (e: { timeStamp: number }) => { holdUntil.current = e.timeStamp + 9000; };
  const go = (e: { timeStamp: number }, k: number) => {
    const target = (k + n) % n;
    if (pinned) {
      const box = pinBox.current;
      if (!box) return;
      const travel = Number(box.dataset.travel || 0);
      scrollTo({ top: box.getBoundingClientRect().top + scrollY + (target / (n - 1)) * travel, behavior: "smooth" });
      return;
    }
    const t = track.current;
    const c = t?.children[target] as HTMLElement | undefined;
    if (!t || !c) return;
    hold(e);
    t.scrollTo({ left: c.offsetLeft - t.offsetLeft, behavior: "smooth" });
  };

  return (
    <section ref={root} id="intelligence" data-live={live ? "1" : undefined} className="bi-root scroll-mt-20 py-10 sm:py-16">
      <div ref={pinBox} className="relative">
        <div className={clsx(pinned && "sticky top-0 flex h-dvh flex-col justify-center py-6")}>
          {/* The band runs the full width of the screen, so the cards travel in from one edge and out past the other. */}
          <div>
            <div className="bi-panel bi-band relative isolate overflow-hidden py-12 sm:py-14">
              <div aria-hidden className="bi-blob bi-blob-a absolute -top-32 -left-24 -z-10 size-[420px] rounded-full" />
              <div aria-hidden className="bi-blob bi-blob-b absolute top-1/3 -right-32 -z-10 size-[460px] rounded-full" />
              <div aria-hidden className="bi-blob bi-blob-c absolute -bottom-40 left-1/3 -z-10 size-[420px] rounded-full" />

              <div className={clsx(W, "flex flex-wrap items-end justify-between gap-6")}>
                <Reveal className="min-w-0 max-w-2xl flex-[1_1_320px]">
                  <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3.5 py-1.5 text-[12.5px] font-medium text-fg/65 ring-1 ring-fg/[0.07] backdrop-blur">
                    <Sparkles className="size-3.5 text-[var(--tint-lavender-ink)]" /> Business intelligence, built in
                  </p>
                  <h2 className={clsx(H2, "mt-4 !text-[clamp(1.9rem,3.6vw,3.2rem)]")}>Software that runs your business. <Mark tone="lavender">Intelligence that reads it.</Mark></h2>
                  <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-fg/58">Because every part of your business lives in one place, Cloudesk sees the whole picture — and turns it into what to do next.</p>
                </Reveal>
                <div className="flex items-center gap-2">
                  <span className="mr-2 text-[13px] text-fg/45 tabular-nums"><b className="font-medium text-fg">{String(at + 1).padStart(2, "0")}</b> / {String(n).padStart(2, "0")}</span>
                  <button type="button" aria-label="Previous" onClick={(e) => go(e, at - 1)} className="grid size-10 place-items-center rounded-full bg-white/70 text-fg/70 ring-1 ring-fg/[0.08] backdrop-blur transition-colors hover:bg-white"><ChevronLeft className="size-4" /></button>
                  <button type="button" aria-label="Next" onClick={(e) => go(e, at + 1)} className="grid size-10 place-items-center rounded-full bg-white/70 text-fg/70 ring-1 ring-fg/[0.08] backdrop-blur transition-colors hover:bg-white"><ChevronRight className="size-4" /></button>
                </div>
              </div>

              <div
                ref={track}
                onPointerDown={hold}
                onTouchStart={hold}
                onWheel={pinned ? undefined : hold}
                aria-label="What Cloudesk's intelligence does"
                className={clsx("bi-bleed mt-8 flex gap-4 lg:mt-10 lg:gap-6", pinned ? "will-change-transform" : "snap-x snap-mandatory overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
              >
                {CARDS.map((c, k) => (
                  <article key={c.title} data-on={k === at || undefined} className={clsx("bi-card group grid w-[86%] shrink-0 snap-start overflow-hidden rounded-[26px] sm:w-[70%] lg:w-[min(980px,72vw)] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]", `tint-${c.tint}`)}>
                    <div className="order-2 flex flex-col p-5 sm:p-7 lg:order-1 lg:p-9">
                      <p className="flex items-center gap-3 text-[12px] font-medium tracking-[0.14em] text-fg/40 uppercase tabular-nums">
                        <span className="tint-chip grid size-9 place-items-center rounded-[11px]"><c.icon className="size-[18px]" /></span>
                        {String(k + 1).padStart(2, "0")}
                      </p>
                      <h3 className="mt-5 text-[clamp(1.4rem,2.2vw,1.9rem)] leading-[1.12] font-[380] tracking-[-0.035em] text-balance">{c.title}</h3>
                      <p className="mt-3 text-[15px] leading-relaxed text-fg/60">{c.body}</p>
                      <ul className="mt-auto grid gap-2 border-t border-fg/[0.07] pt-5 max-lg:mt-5">
                        {c.points.map((p) => (
                          <li key={p} className="flex gap-2.5 text-[14px] text-fg/70"><Check className="tint-ink mt-0.5 size-4 shrink-0" />{p}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="bi-stage relative order-1 m-2 grid aspect-[4/3] place-items-center overflow-hidden rounded-[20px] lg:order-2 lg:aspect-auto lg:min-h-[min(400px,44vh)]">
                      <div className="bi-device relative grid w-full place-items-center">{c.device}</div>
                      {c.note}
                    </div>
                  </article>
                ))}
              </div>

              <div className={clsx(W, "mt-7 flex flex-wrap items-center justify-between gap-4")}>
                <div className="flex min-w-[160px] flex-1 items-center gap-1.5" aria-hidden>
                  {pinned ? (
                    <span className="relative h-[3px] w-full max-w-[420px] overflow-hidden rounded-full bg-fg/[0.08]"><span className="bi-progress absolute inset-0 origin-left rounded-full bg-fg" /></span>
                  ) : (
                    CARDS.map((c, k) => <span key={c.title} className={clsx("h-1.5 rounded-full transition-all duration-500", k === at ? "w-6 bg-fg" : "w-1.5 bg-fg/20")} />)
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Link href="/start" className="p-cta lx-sheen inline-flex h-11 items-center gap-2 px-6 text-[14.5px]">Start free <ArrowRight className="size-4" /></Link>
                  <Link href="/features/copilot" className="inline-flex h-11 items-center rounded-full bg-white/60 px-5 text-[14px] font-medium text-fg/80 ring-1 ring-fg/[0.1] backdrop-blur transition-colors hover:bg-white hover:text-fg">Meet the copilot</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
