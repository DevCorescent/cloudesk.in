"use client";

// "Your workday, included" on the homepage, as a small desktop: a dock with
// the six everyday tools, one app window showing the open tool's real
// screen, and a notification sliding in to show what it just handed to
// another tool — the point of them being built together. It moves on by
// itself (pausing on hover or a pick), the wallpaper taking each tool's
// pastel; still for reduced motion.
import clsx from "clsx";
import { ArrowRight, BellRing, CalendarDays, CheckCheck, FileText, Inbox, ListChecks, Mail, MessagesSquare, NotebookPen, ShieldAlert, Sparkles, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Tint } from "@/lib/workspace/modules";
import { Reveal } from "./interactive";
import { W } from "./sections";

type Tool = {
  slug: string;
  label: string;
  icon: LucideIcon;
  tint: Tint;
  title: string;
  body: string;
  chips: [string, string];
  img: string;
  alt: string;
  /** Zoom into what matters on the screen: scale, and the point it grows from. */
  zoom: number;
  pos: string;
  /** What this tool just handed to another one. */
  handoff: { icon: LucideIcon; app: string; text: string };
};

const TOOLS: Tool[] = [
  { slug: "mail", label: "Mail", icon: Mail, tint: "sky", title: "Every inbox, sorted before you look.", body: "Gmail, Outlook, Zoho or your own domain — screened for phishing, invites ready to add.", chips: ["Smart sorting", "Recurring emails"], img: "workspace/mail-meeting", alt: "Mail: a meeting invite with Join, In your calendar and Going? Yes, Maybe, No", zoom: 1.18, pos: "60% 10%", handoff: { icon: CalendarDays, app: "Calendar", text: "Invite from Rao & Sons added for Thu, 11:00" } },
  { slug: "my-work", label: "My work", icon: Inbox, tint: "lavender", title: "Everything waiting on you.", body: "Approvals, tasks and follow-ups from every feature — overdue first, one click to act.", chips: ["Approve in place", "Due today"], img: "workspace/my-work", alt: "My work: an overdue task, today's tasks and reminders", zoom: 1.35, pos: "42% 12%", handoff: { icon: CheckCheck, app: "Chat", text: "Leave approved — Priya told in #team" } },
  { slug: "calendar", label: "Calendar", icon: CalendarDays, tint: "mint", title: "Meetings, from invite to minutes.", body: "Invites found in your email, reminders through the day, minutes shared after.", chips: ["Week & agenda", "Meeting links"], img: "calendar/week", alt: "The calendar week with meetings and an invite from email", zoom: 1.3, pos: "52% 18%", handoff: { icon: NotebookPen, app: "Notes", text: "Minutes of “Banquet review” saved" } },
  { slug: "chat", label: "Chat", icon: MessagesSquare, tint: "peach", title: "Team chat, with the work in it.", body: "Invoices and deals as cards, approvals and polls — and AI that catches you up.", chips: ["Threads", "Records as cards"], img: "chat/channel", alt: "A Chat channel with a quotation card, an approval and a decision", zoom: 1.3, pos: "58% 22%", handoff: { icon: FileText, app: "Invoicing", text: "Quotation QT-118 shared as a live card" } },
  { slug: "notes", label: "Notes", icon: NotebookPen, tint: "butter", title: "Notes that do the follow-up.", body: "Daily notes that fill themselves in, live maths — and action items into tasks.", chips: ["Daily notes", "“/” elements"], img: "notes/editor", alt: "A meeting note with a table and live calculations", zoom: 1.3, pos: "60% 14%", handoff: { icon: ListChecks, app: "My work", text: "3 action items turned into tasks" } },
  { slug: "copilot", label: "Copilot", icon: Sparkles, tint: "rose", title: "Ask your business anything.", body: "Answers from your own sales, dues, stock and people — and checks that run themselves.", chips: ["Your own numbers", "Respects access"], img: "copilot/checks", alt: "Copilot checks: a possible duplicate supplier bill and a spending spike", zoom: 1.2, pos: "62% 14%", handoff: { icon: ShieldAlert, app: "Accounts", text: "Possible duplicate bill held for review" } },
];
const MS = 5200;

export function WorkdayDock() {
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
    const t = setTimeout(() => setAt((a) => (a + 1) % TOOLS.length), MS);
    return () => clearTimeout(t);
  }, [at, paused, reduce]);
  const cur = TOOLS[at]!;
  const Hand = cur.handoff.icon;
  const pick = (k: number) => (setAt(k), setPaused(true));

  return (
    <section id="tools" className="relative pt-6 pb-16 sm:pt-10 sm:pb-24">
      <div className={W}>
        <Reveal className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Your workday, included</p>
            <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.06] font-[380] tracking-[-0.04em]">Six tools. <span className="text-fg/40">One desk.</span></h2>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <p className="max-w-md text-[15px] leading-relaxed text-fg/60 lg:text-right">Built together — an invite in your email is already in your calendar. Mail, Calendar, Chat and Notes come with every plan, Free included.</p>
            <Link href="/start" className="group inline-flex w-fit items-center gap-1.5 rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-bg transition-transform hover:-translate-y-0.5">Get all six free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></Link>
          </div>
        </Reveal>
      </div>

      {/* The desk runs the full width of the screen; its contents keep to the page's width. */}
      <Reveal delay={80}>
          <div className={clsx("wd-desk wd-band relative isolate overflow-hidden py-6 lg:py-8", `tint-${cur.tint}`)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            {/* Wallpaper: every tool's pastel stays mounted and cross-fades. */}
            {TOOLS.map((t, k) => <span key={t.slug} aria-hidden className={clsx("wd-wall absolute inset-0 -z-10", `tint-${t.tint}`, k === at && "is-on")} />)}

            {/* Phones: the dock first, as a row. */}
            <div className={clsx(W, "relative")}>
            <div className="flex gap-1.5 overflow-x-auto py-3 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Everyday tools">
              {TOOLS.map((t, k) => (
                <button key={t.slug} type="button" role="tab" aria-selected={k === at} onClick={() => pick(k)} className={clsx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors", k === at ? "bg-fg text-bg" : "bg-white/70 text-fg/65")}>
                  <t.icon className="size-4" /> {t.label}
                </button>
              ))}
            </div>

            <div className="grid gap-5 pb-3 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-center lg:gap-12 lg:py-6 lg:pb-24">
              {/* What the open tool does */}
              <div key={cur.slug} className="mk-slide-in order-2 rounded-[22px] bg-white/75 p-5 ring-1 ring-white backdrop-blur-xl lg:order-1 lg:p-6">
                <p className="flex items-center gap-2.5 text-[12.5px] font-semibold tracking-wide text-fg/55 uppercase">
                  <span className="tint-chip grid size-9 place-items-center rounded-[11px]"><cur.icon className="size-[18px]" /></span>
                  {cur.label}
                </p>
                <h3 className="mt-4 text-[clamp(1.3rem,2vw,1.65rem)] leading-[1.15] font-[400] tracking-[-0.03em]">{cur.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-fg/60">{cur.body}</p>
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {cur.chips.map((x) => <li key={x} className="rounded-full bg-fg/[0.05] px-2.5 py-1 text-[12px] font-medium text-fg/70">{x}</li>)}
                </ul>
                <Link href={`/features/${cur.slug}`} className="group mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold">Explore {cur.label} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></Link>
              </div>

              {/* The app window */}
              <div className="relative order-1 lg:order-2">
                <div className="overflow-hidden rounded-[16px] bg-white shadow-[0_40px_80px_-40px_rgb(30_20_70/0.55)] ring-1 ring-fg/[0.08]">
                  <div className="flex h-8 items-center gap-1.5 border-b border-fg/[0.06] px-3.5">
                    <i className="size-2.5 rounded-full bg-[#ff5f57]" />
                    <i className="size-2.5 rounded-full bg-[#febc2e]" />
                    <i className="size-2.5 rounded-full bg-[#28c840]" />
                    <span key={cur.slug} className="mk-slide-in mx-auto text-[11.5px] font-medium text-fg/50">{cur.label} — Cloudesk</span>
                  </div>
                  <div className="relative aspect-[16/10] overflow-hidden">
                    {TOOLS.map((t, k) => (
                      <div key={t.slug} aria-hidden={k !== at} className={clsx("absolute inset-0 transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(.2,.8,.2,1)]", k === at ? "opacity-100" : "scale-[1.02] opacity-0")}>
                        <Image src={`/marketing/${t.img}.jpg`} alt={k === at ? t.alt : ""} fill sizes="(min-width: 1024px) 900px, 95vw" className="object-cover object-left-top" style={{ transform: `scale(${t.zoom})`, transformOrigin: t.pos }} />
                      </div>
                    ))}
                  </div>
                </div>
                {/* The hand-off, as a notification */}
                <div key={`n-${cur.slug}`} className="wd-note absolute top-12 right-3 z-10 flex w-[min(300px,80%)] items-start gap-3 rounded-[16px] bg-white/90 p-3 shadow-[0_20px_44px_-18px_rgb(30_20_70/0.5)] ring-1 ring-fg/[0.06] backdrop-blur-xl sm:right-5">
                  <span className="tint-chip grid size-9 shrink-0 place-items-center rounded-[11px]"><Hand className="size-[18px]" /></span>
                  <span className="min-w-0 text-[12.5px] leading-snug">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-fg/45 uppercase"><BellRing className="size-3" /> {cur.label} → {cur.handoff.app}</span>
                    <span className="mt-0.5 block font-medium text-fg/85">{cur.handoff.text}</span>
                  </span>
                </div>
              </div>
            </div>

            </div>

            {/* The dock (wide screens) */}
            <div className="absolute bottom-9 left-1/2 hidden -translate-x-1/2 lg:block">
              <div className="wd-dock flex items-end gap-2 rounded-[22px] bg-white/55 p-2 ring-1 ring-white/80 backdrop-blur-2xl" role="tablist" aria-label="Everyday tools">
                {TOOLS.map((t, k) => (
                  <button key={t.slug} type="button" role="tab" aria-selected={k === at} aria-label={t.label} onClick={() => pick(k)} className={clsx("wd-app group relative grid size-12 place-items-center rounded-[14px]", `tint-${t.tint}`, k === at && "is-on")}>
                    <span className="tint-chip grid size-full place-items-center rounded-[14px] shadow-[0_6px_14px_-6px_rgb(30_20_70/0.35)]"><t.icon className="size-[21px]" /></span>
                    {k === at && !paused && !reduce && (
                      <svg key={`r-${at}`} viewBox="0 0 52 52" className="pointer-events-none absolute -inset-[2px] size-[calc(100%+4px)]" aria-hidden>
                        <rect x="1.5" y="1.5" width="49" height="49" rx="15" pathLength={1} className="wd-ring" style={{ animationDuration: `${MS}ms` }} />
                      </svg>
                    )}
                    <span className="wd-tip pointer-events-none absolute -top-9 rounded-full bg-fg px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap text-bg">{t.label}</span>
                    <span className={clsx("absolute -bottom-1.5 size-1 rounded-full bg-fg transition-opacity", k === at ? "opacity-80" : "opacity-0")} />
                  </button>
                ))}
              </div>
            </div>
          </div>
      </Reveal>
    </section>
  );
}
