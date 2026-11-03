"use client";

// Cloudesk Notes on the homepage, as a motion stage across the full width:
// a MacBook that moves through six real Notes screens — each zoomed into what
// matters — with a small animated graphic for that feature beside it, and a
// rail of six pills to jump between them. Very little text on purpose.
// Moves on by itself, pauses on hover or a pick; still for reduced motion.
import clsx from "clsx";
import { ArrowRight, AtSign, CalendarDays, Check, CheckCheck, FileText, Handshake, Link2, ListChecks, Mail, MessagesSquare, NotebookPen, Shapes, Share2, Sigma, Sparkles, Table2, ToggleLeft, Users, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mark, Reveal } from "./interactive";
import { MacBook } from "./macbook";
import { W } from "./sections";

/* ───────── the motion graphic for each scene ───────── */

const Pill = ({ icon: Icon, children, className, style }: { icon: LucideIcon; children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
  <span className={clsx("ns-pop inline-flex items-center gap-2 rounded-full bg-white py-1.5 pr-3.5 pl-1.5 text-[12.5px] font-medium whitespace-nowrap text-fg/80 shadow-[0_14px_30px_-14px_rgb(60_40_0/0.4)] ring-1 ring-fg/[0.06]", className)} style={style}>
    <span className="grid size-7 place-items-center rounded-full bg-[var(--p-butter)] text-[var(--p-butter-ink)]"><Icon className="size-3.5" /></span>
    {children}
  </span>
);

function DailyArt() {
  return (
    <div className="grid gap-2.5">
      {[["11:30", "Supplier call"], ["15:00", "Tasting · Kiran"]].map(([t, x], k) => (
        <span key={t} className="ns-fly flex items-center gap-2.5 rounded-[14px] bg-white p-2 pr-4 shadow-[0_16px_34px_-16px_rgb(60_40_0/0.45)] ring-1 ring-fg/[0.06]" style={{ animationDelay: `${0.25 + k * 0.35}s` }}>
          <span className="grid size-9 place-items-center rounded-[10px] bg-[var(--p-mint)] text-[var(--p-mint-ink)]"><CalendarDays className="size-4" /></span>
          <span className="text-[12.5px] leading-tight"><b className="block font-semibold tabular-nums">{t}</b><span className="text-fg/55">{x}</span></span>
        </span>
      ))}
      <Pill icon={Check} style={{ animationDelay: "1.1s" }}>Task due added</Pill>
    </div>
  );
}

function ElementsArt() {
  const els: [LucideIcon, string][] = [[Table2, "Table"], [ListChecks, "To-do"], [ToggleLeft, "Toggle"], [Sigma, "Calculation"]];
  return (
    <div className="relative grid justify-items-center gap-3">
      <span className="ns-key grid size-16 place-items-center rounded-[16px] bg-white text-[30px] font-light text-fg/80 shadow-[0_6px_0_rgb(0_0_0/0.08),0_20px_40px_-16px_rgb(60_40_0/0.45)] ring-1 ring-fg/[0.08]">/</span>
      <div className="grid grid-cols-2 gap-2">
        {els.map(([Icon, x], k) => <Pill key={x} icon={Icon} style={{ animationDelay: `${0.5 + k * 0.14}s` }}>{x}</Pill>)}
      </div>
    </div>
  );
}

function MathsArt() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start - 300) / 1400);
      setN(Math.round(92040 * (p <= 0 ? 0 : 1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="ns-pop grid gap-2 rounded-[18px] bg-white p-4 shadow-[0_20px_44px_-18px_rgb(60_40_0/0.45)] ring-1 ring-fg/[0.06]">
      <span className="font-mono text-[11.5px] text-fg/45">total = food + 18%</span>
      <span className="text-[28px] leading-none font-[400] tracking-[-0.03em] tabular-nums">₹{n.toLocaleString("en-IN")}</span>
      <span className="ns-bar h-1 rounded-full bg-[var(--p-butter-ink)]/70" />
    </div>
  );
}

function LinksArt() {
  const recs: [LucideIcon, string][] = [[Users, "Kiran Textiles"], [FileText, "INV-204"], [Handshake, "Banquet deal"]];
  return (
    <div className="relative grid gap-3">
      {recs.map(([Icon, x], k) => (
        <span key={x} className="flex items-center gap-2">
          <Pill icon={Icon} style={{ animationDelay: `${0.25 + k * 0.25}s` }}>{x}</Pill>
          <svg viewBox="0 0 60 10" className="ns-dash h-2.5 w-12" aria-hidden style={{ animationDelay: `${0.5 + k * 0.25}s` }}><line x1="0" y1="5" x2="60" y2="5" pathLength={1} /></svg>
          <span className="ns-pop grid size-8 place-items-center rounded-full bg-[var(--p-butter-ink)] text-white" style={{ animationDelay: `${0.75 + k * 0.25}s` }}><NotebookPen className="size-3.5" /></span>
        </span>
      ))}
    </div>
  );
}

function AiArt() {
  return (
    <div className="grid justify-items-start gap-2.5">
      <span className="ns-orb grid size-14 place-items-center rounded-full text-white"><Sparkles className="size-6" /></span>
      {["Confirm 120 plates", "Book two servers", "Send updated quote"].map((x, k) => (
        <span key={x} className="ns-fly flex items-center gap-2 rounded-[12px] bg-white py-1.5 pr-3.5 pl-1.5 text-[12.5px] font-medium shadow-[0_14px_30px_-14px_rgb(60_40_0/0.4)] ring-1 ring-fg/[0.06]" style={{ animationDelay: `${0.5 + k * 0.3}s` }}>
          <span className="ns-tick grid size-6 place-items-center rounded-[7px] bg-[var(--p-mint)] text-[var(--p-mint-ink)]" style={{ animationDelay: `${0.8 + k * 0.3}s` }}><CheckCheck className="size-3.5" /></span>
          {x}
        </span>
      ))}
      <Pill icon={ListChecks} style={{ animationDelay: "1.7s" }}>→ My work</Pill>
    </div>
  );
}

function ShareArt() {
  const to: [LucideIcon, string][] = [[Users, "Team"], [MessagesSquare, "Chat"], [Mail, "Email"], [Link2, "Link"]];
  return (
    <div className="relative grid size-[210px] place-items-center">
      <span className="ns-pop grid size-14 place-items-center rounded-full bg-[var(--p-butter-ink)] text-white shadow-[0_16px_34px_-12px_rgb(60_40_0/0.55)]"><Share2 className="size-6" /></span>
      {to.map(([Icon, x], k) => {
        const a = (k / to.length) * Math.PI * 2 - Math.PI / 4;
        return (
          <span key={x} className="ns-orbit absolute" style={{ left: `${50 + Math.cos(a) * 40}%`, top: `${50 + Math.sin(a) * 40}%`, animationDelay: `${0.35 + k * 0.15}s` }}>
            <span className="-translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-full bg-white py-1.5 pr-3 pl-1.5 text-[12px] font-medium shadow-[0_14px_30px_-14px_rgb(60_40_0/0.4)] ring-1 ring-fg/[0.06]">
              <span className="grid size-6 place-items-center rounded-full bg-[var(--p-butter)] text-[var(--p-butter-ink)]"><Icon className="size-3.5" /></span>{x}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ───────── the scenes ───────── */

type Scene = { key: string; icon: LucideIcon; label: string; line: string; img: string; alt: string; zoom: number; pos: string; art: () => React.ReactNode };
const SCENES: Scene[] = [
  { key: "daily", icon: CalendarDays, label: "Daily notes", line: "Your day, already in.", img: "daily", alt: "Today's daily note with two meetings and a task due", zoom: 1.35, pos: "62% 22%", art: DailyArt },
  { key: "elements", icon: Shapes, label: "Every element", line: "Type “/” for anything.", img: "editor", alt: "A meeting note with the Elements panel open", zoom: 1.45, pos: "98% 22%", art: ElementsArt },
  { key: "maths", icon: Sigma, label: "Live maths", line: "Sums that update as you type.", img: "slash", alt: "Diwali order maths: guests, per plate, food and total with GST", zoom: 1.55, pos: "52% 14%", art: MathsArt },
  { key: "links", icon: AtSign, label: "On every page", line: "Notes on any customer or invoice.", img: "page", alt: "A note on a CRM record, linked to the page", zoom: 1.3, pos: "70% 16%", art: LinksArt },
  { key: "ai", icon: Sparkles, label: "AI follow-up", line: "Action items become tasks.", img: "slash", alt: "Decisions and action items in a meeting note", zoom: 1.5, pos: "44% 62%", art: AiArt },
  { key: "share", icon: Share2, label: "Share anywhere", line: "Team, chat, email or a link.", img: "share", alt: "Sharing a note with the workspace, in a chat, by email or a public link", zoom: 1.55, pos: "54% 50%", art: ShareArt },
];
const MS = 4600;

export function NotesShow() {
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
    const t = setTimeout(() => setAt((a) => (a + 1) % SCENES.length), MS);
    return () => clearTimeout(t);
  }, [at, paused, reduce]);
  // Keep the active pill in view in the rail (it scrolls on phones), without moving the page.
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = rail.current;
    const tab = r?.children[at] as HTMLElement | undefined;
    if (r && tab && r.scrollWidth > r.clientWidth) r.scrollTo({ left: tab.offsetLeft - r.offsetLeft - (r.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [at]);
  const cur = SCENES[at]!;
  const Art = cur.art;
  const pick = (k: number) => (setAt(k), setPaused(true));

  return (
    <section id="notes" className="relative py-12 sm:py-16">
      <div className="ns-band relative isolate overflow-hidden py-14 sm:py-20" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <span aria-hidden className="ns-glow pointer-events-none absolute inset-0 -z-10" />
        <Reveal className={clsx(W, "flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between")}>
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-[12.5px] font-medium text-[var(--p-butter-ink)] ring-1 ring-fg/[0.06]"><NotebookPen className="size-3.5" /> New · Cloudesk Notes</p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,3.4rem)] leading-[1.05] font-[380] tracking-[-0.04em]">Notes that <Mark tone="butter">do the follow-up.</Mark></h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/features/notes" className="p-cta lx-sheen inline-flex h-11 items-center gap-2 px-6 text-[14.5px]">Explore Notes <ArrowRight className="size-4" /></Link>
            <Link href="/start" className="inline-flex h-11 items-center rounded-full bg-white/75 px-5 text-[14px] font-medium ring-1 ring-fg/[0.08] transition-colors hover:bg-white">Try it free · in every plan</Link>
          </div>
        </Reveal>

        {/* The stage: the MacBook, with the scene's motion graphic beside it. */}
        <div className={clsx(W, "relative mt-10 sm:mt-14")}>
          <div className="relative mx-auto w-full max-w-[1100px] lg:w-[72%]">
            <MacBook>
              {SCENES.map((s, k) => (
                <div key={s.key} aria-hidden={k !== at} className={clsx("absolute inset-0 transition-opacity duration-[900ms] ease-out", k === at ? "opacity-100" : "opacity-0")}>
                  <Image src={`/marketing/notes/${s.img}.jpg`} alt={k === at ? s.alt : ""} fill sizes="(min-width: 1024px) 800px, 95vw" className={clsx("object-cover object-left-top", k === at && !reduce && "ns-zoom")} style={{ transformOrigin: s.pos, ["--z" as string]: String(s.zoom) }} />
                </div>
              ))}
            </MacBook>
            {/* The graphic: beside the laptop on wide screens, over its corner on phones. */}
            <div key={cur.key} className="ns-art pointer-events-none absolute z-10 max-lg:right-2 max-lg:-bottom-6 max-lg:origin-bottom-right max-lg:scale-[0.72] lg:top-1/2 lg:-right-[14%] lg:origin-left lg:-translate-y-1/2 xl:-right-[17%] xl:scale-110" aria-hidden>
              <Art />
            </div>
            <p key={`l-${cur.key}`} className="mk-slide-in absolute -bottom-12 left-1/2 hidden -translate-x-1/2 text-[15px] text-fg/55 lg:block">{cur.line}</p>
          </div>
        </div>

        {/* The rail */}
        <div className={clsx(W, "mt-14 lg:mt-24")}>
          <div ref={rail} role="tablist" aria-label="What Notes does" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:justify-center [&::-webkit-scrollbar]:hidden">
            {SCENES.map((s, k) => (
              <button key={s.key} type="button" role="tab" aria-selected={k === at} onClick={() => pick(k)} className={clsx("relative inline-flex h-11 shrink-0 items-center gap-2 overflow-hidden rounded-full px-4 text-[13.5px] font-medium transition-[background-color,color,box-shadow] duration-300", k === at ? "bg-fg text-bg shadow-[0_12px_28px_-14px_rgb(0_0_0/0.6)]" : "bg-white/70 text-fg/65 ring-1 ring-fg/[0.07] hover:bg-white hover:text-fg")}>
                <s.icon className="size-4" /> {s.label}
                {k === at && !paused && !reduce && <span key={`p-${at}`} aria-hidden className="ns-prog absolute bottom-0 left-0 h-[2px] w-full bg-white/60" style={{ animationDuration: `${MS}ms` }} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
