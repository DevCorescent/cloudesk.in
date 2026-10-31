// Two homepage spotlights: Notes (real screens from the app) and the partner
// program (its live rates, and the example partner dashboard — labelled as
// sample numbers). Server components; the interactive bits are client islands.
import clsx from "clsx";
import { ArrowRight, BellRing, Calculator, CalendarDays, Check, Inbox as InboxIcon, ListChecks, Mail as MailIcon, MessagesSquare, NotebookPen, Shapes, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Mark, Reveal } from "@/components/marketing/interactive";
import { PhoneFrame } from "@/components/marketing/phone-deck";
import { SLIDE, SLIDER, W } from "@/components/marketing/sections";
import { ShotFrame } from "@/components/marketing/shot-tour";
import { TYPE_ICON } from "@/components/partners/icons";
import { HeroDashboard } from "@/components/partners/showcase";
import { pct, TYPE_LIST, type PartnerType } from "@/lib/partners/program";

const shot = (name: string, alt: string) => ({ src: `/marketing/notes/${name}.jpg`, w: 2880, h: 1800, alt });

const NOTE_POINTS = [
  { icon: CalendarDays, title: "Daily notes", body: "Today's meetings and tasks, already in." },
  { icon: Shapes, title: "Every element", body: "Type “/” — tables, to-dos, toggles, callouts." },
  { icon: Calculator, title: "Live maths", body: "Calculations that update as you type." },
  { icon: NotebookPen, title: "On every page", body: "Notes on any invoice, deal or customer." },
  { icon: Sparkles, title: "AI follow-up", body: "Summaries, and action items into tasks." },
  { icon: MessagesSquare, title: "Share anywhere", body: "Your team, a chat, an email or a link." },
];

export function NotesSpotlight() {
  return (
    <section id="notes" className="relative py-20 sm:py-28">
      <div className={W}>
        <div className="relative overflow-hidden rounded-[36px] bg-[linear-gradient(160deg,var(--p-butter)_0%,color-mix(in_srgb,var(--p-butter)_35%,var(--p-canvas,#faf9f7))_45%,var(--p-canvas,#faf9f7)_100%)] px-5 py-12 ring-1 ring-fg/[0.05] sm:px-10 sm:py-16 lg:px-14 lg:py-20">
          <span aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-[420px] rounded-full bg-[var(--p-peach)] opacity-60 blur-3xl" />
          <div className="relative grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
            <Reveal className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-[12.5px] font-medium text-[var(--p-butter-ink)] ring-1 ring-fg/[0.06]"><NotebookPen className="size-3.5" /> New · Cloudesk Notes</p>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3.4rem)] leading-[1.05] font-[380] tracking-[-0.04em]">Notes that <Mark tone="butter">do the follow-up.</Mark></h2>
              <p className="mt-5 max-w-lg text-[16.5px] leading-relaxed font-[350] text-fg/62">Write meeting notes, call notes and plans in blocks you can drag around. They link to your customers, invoices and tasks, fill in your day for you — and AI turns what was agreed into work that gets done.</p>
              <ul className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {NOTE_POINTS.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex items-start gap-3 rounded-[16px] bg-white/65 p-3 ring-1 ring-fg/[0.05]">
                    <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--p-butter)] text-[var(--p-butter-ink)]"><Icon className="size-[17px]" /></span>
                    <span className="min-w-0"><span className="block text-[14px] font-semibold">{title}</span><span className="block text-[12.5px] leading-snug text-fg/55">{body}</span></span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/features/notes" className="p-cta lx-sheen inline-flex items-center gap-2 px-6">Explore Notes <ArrowRight className="size-4" /></Link>
                <Link href="/start" className="inline-flex h-12 items-center rounded-full bg-white/75 px-6 text-[15px] font-medium ring-1 ring-fg/[0.08] transition-colors hover:bg-white">Try it free</Link>
              </div>
              <p className="mt-4 text-[12.5px] text-fg/45">Included in every plan, Free too.</p>
            </Reveal>

            <Reveal delay={120} className="relative min-w-0">
              {/* Wide screens: the editor, with the daily note and the “/” menu floating over it. */}
              <div className="relative hidden pb-[12%] sm:block">
                <ShotFrame shot={shot("editor", "A meeting note with an agenda, a supplier price table and live calculations, with the Elements panel open")} url="cloudesk · Notes" sizes="(min-width: 1280px) 860px, 100vw" />
                <div className="absolute -bottom-2 -left-4 w-[46%] rotate-[-2deg] lg:-left-10">
                  <ShotFrame shot={shot("daily", "Today's daily note with two meetings and a task due")} url="Today" sizes="420px" zoom={{ s: 1.9, x: 70, y: 18 }} />
                </div>
                <div className="absolute -right-3 -bottom-6 w-[40%] rotate-[2deg] lg:-right-8">
                  <ShotFrame shot={shot("share", "Sharing a note: with the workspace, in a chat, by email or a public link")} bare sizes="380px" zoom={{ s: 1.75, x: 50, y: 46 }} />
                </div>
              </div>
              <div className="mx-auto w-[min(70vw,290px)] sm:hidden">
                <PhoneFrame src="/marketing/phones/notes.jpg" alt="A meeting note with a table, on a phone" />
              </div>
              <div className="absolute top-[8%] -left-3 hidden items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[12.5px] font-medium shadow-[0_18px_40px_-18px_rgb(0_0_0/0.35)] ring-1 ring-fg/[0.06] lg:inline-flex" aria-hidden><Check className="size-3.5 text-[var(--p-mint-ink)]" /> Saved · 3 tasks created</div>
              <div className="absolute top-[38%] -right-4 hidden items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[12.5px] font-medium shadow-[0_18px_40px_-18px_rgb(0_0_0/0.35)] ring-1 ring-fg/[0.06] xl:inline-flex" aria-hidden><BellRing className="size-3.5 text-[var(--p-peach-ink)]" /> Remind me Friday, 9 am</div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

type Rates = { types: { id: PartnerType; commissionBps: number; commissionMonths: number; discountBps: number }[]; tiers: { bonusBps: number }[]; minPayout: number };

export function PartnersSpotlight({ program, origin }: { program: Rates; origin: string }) {
  const topBonus = Math.max(0, ...program.tiers.map((t) => t.bonusBps));
  const topRate = Math.max(...program.types.map((t) => t.commissionBps)) + topBonus;
  const longest = Math.max(...program.types.map((t) => t.commissionMonths));
  return (
    <section id="partners" className="relative py-20 sm:py-28">
      <div className={W}>
        <div className="mk-deep mk-deep-plum relative overflow-hidden rounded-[36px] px-5 py-12 sm:px-10 sm:py-16 lg:px-14 lg:py-20">
          <span aria-hidden className="pointer-events-none absolute -top-40 -left-24 size-[520px] rounded-full bg-[#a78bfa] opacity-[0.16] blur-[120px]" />
          <span aria-hidden className="pointer-events-none absolute -right-20 -bottom-40 size-[520px] rounded-full bg-[#fdba8c] opacity-[0.12] blur-[130px]" />
          <div className="relative grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
            <Reveal className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1 text-[12.5px] font-medium text-white/75 ring-1 ring-white/10"><span className="size-1.5 rounded-full bg-[#7dd3a8]" /> Cloudesk Partner Program</p>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3.4rem)] leading-[1.05] font-[380] tracking-[-0.04em]">Recommend Cloudesk. <span className="mk-logo-gradient">Earn every month.</span></h2>
              <p className="mt-5 max-w-lg text-[16.5px] leading-relaxed font-[350] text-white/65">Agencies, freelancers, sales and marketing partners and creators earn up to <b className="font-semibold text-white">{pct(topRate)}</b> of what every customer they bring pays{longest ? ` — for up to ${longest} months` : ""}. Your customers get a discount, you get a live dashboard and payouts on request.</p>
              <ul className="mt-8 grid grid-cols-1 gap-2">
                {TYPE_LIST.map((x) => {
                  const t = program.types.find((y) => y.id === x.id);
                  if (!t) return null;
                  const Icon = TYPE_ICON[x.id];
                  return (
                    <li key={x.id} className="flex min-w-0 items-center gap-3 rounded-[16px] bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.07]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-white/[0.08]"><Icon className="size-[17px] text-white/85" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">{x.name}</span><span className="block truncate text-[12.5px] text-white/50">{x.short}</span></span>
                      <span className="shrink-0 text-right"><span className="block text-[17px] font-semibold tabular-nums">{pct(t.commissionBps)}</span><span className="block text-[11px] text-white/45">{t.commissionMonths ? `${t.commissionMonths} months` : "always"}</span></span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/partners#apply" className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-[#0e0d14] transition-transform hover:-translate-y-0.5">Become a partner <ArrowRight className="size-4" /></Link>
                <Link href="/partners#calculator" className="inline-flex h-12 items-center rounded-full px-6 text-[15px] font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/[0.06]">What could I earn?</Link>
              </div>
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/55">
                {["Free to join", "No targets", `Payouts from ₹${Math.round(program.minPayout / 100).toLocaleString("en-IN")}`].map((x) => <li key={x} className="inline-flex items-center gap-1.5"><ListChecks className="size-3.5 text-[#7dd3a8]" />{x}</li>)}
              </ul>
            </Reveal>
            <Reveal delay={120} className="min-w-0">
              <HeroDashboard origin={origin} dark />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── The workday, as cards ─────────────────────────────────────────────────

type Card = { slug: string; zoom: number; label: string; icon: typeof NotebookPen; tint: "lavender" | "sky" | "mint" | "peach" | "butter" | "rose"; title: string; body: string; chips: string[]; img: string; alt: string; pos: string; span: string; tall?: boolean; wide?: boolean };

const CARDS: Card[] = [
  { slug: "mail", zoom: 1.25, label: "Mail", icon: MailIcon, tint: "sky", title: "Every inbox, sorted before you look.", body: "Gmail, Outlook, Zoho or your own domain in one inbox — screened for phishing, with meeting invites ready to add and the customer beside their email.", chips: ["Smart sorting", "Email → Notes, Calendar, Chat", "Recurring emails"], img: "/marketing/workspace/mail-meeting.jpg", alt: "Mail: a meeting invite with Join, In your calendar and Going? Yes, Maybe, No", pos: "58% 8%", span: "lg:col-span-7", tall: true },
  { slug: "my-work", zoom: 1.7, label: "My work", icon: InboxIcon, tint: "lavender", title: "Everything waiting on you.", body: "Approvals, tasks, follow-ups and reminders from every feature — overdue first, one click to act.", chips: ["Approve in place", "Due today", "Reminders"], img: "/marketing/workspace/my-work.jpg", alt: "My work: an overdue task, today's tasks and reminders", pos: "42% 12%", span: "lg:col-span-5", tall: true },
  { slug: "calendar", zoom: 1.9, label: "Calendar", icon: CalendarDays, tint: "mint", title: "Meetings, from invite to minutes.", body: "Invites found in your email, reminders through the day, minutes shared when it's over.", chips: ["Week & agenda", "Meeting links"], img: "/marketing/calendar/week.jpg", alt: "The calendar week with meetings and an invite from email", pos: "52% 18%", span: "lg:col-span-4" },
  { slug: "chat", zoom: 1.9, label: "Chat", icon: MessagesSquare, tint: "peach", title: "Team chat, with the work in it.", body: "Invoices and deals as cards, approvals, polls and decisions — and AI that catches you up.", chips: ["Threads", "Records as cards"], img: "/marketing/chat/channel.jpg", alt: "A Chat channel with a quotation card, an approval and a decision", pos: "58% 22%", span: "lg:col-span-4" },
  { slug: "notes", zoom: 1.9, label: "Notes", icon: NotebookPen, tint: "butter", title: "Notes that do the follow-up.", body: "Daily notes that fill themselves in, live maths, notes on any record — and action items into tasks.", chips: ["Daily notes", "“/” elements"], img: "/marketing/notes/editor.jpg", alt: "A meeting note with a table and live calculations", pos: "60% 14%", span: "lg:col-span-4" },
  { slug: "copilot", zoom: 1.35, label: "Copilot", icon: Sparkles, tint: "rose", title: "Ask your business anything.", body: "Questions in plain words, answered from your own sales, dues, stock and people — and checks that run by themselves, like a supplier bill entered twice or spending well above usual.", chips: ["Your own numbers", "Respects access", "Checks that run themselves"], img: "/marketing/copilot/checks.jpg", alt: "Copilot checks: a possible duplicate supplier bill and a spending spike, found by themselves", pos: "62% 14%", span: "lg:col-span-12", wide: true },
];

export function WorkdayCards() {
  return (
    <section id="tools" className="relative pt-6 pb-16 sm:pt-10 sm:pb-24">
      <div className={W}>
        <Reveal className="mb-8 flex flex-col gap-4 sm:mb-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Your workday, included</p>
            <h2 className="mt-3 text-[clamp(1.9rem,3.8vw,3.2rem)] leading-[1.06] font-[380] tracking-[-0.04em]">Six tools you&apos;ll open every day.</h2>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <p className="max-w-md text-[15px] leading-relaxed text-fg/60 lg:text-right">Built together, so an invite in your email is already in your calendar and an invoice shares into chat. Mail, Calendar, Chat and Notes come with every plan — Free included.</p>
            <Link href="/start" className="group inline-flex w-fit items-center gap-1.5 rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-bg transition-transform hover:-translate-y-0.5">Get all six free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></Link>
          </div>
        </Reveal>
        <div className={clsx(SLIDER, "lg:grid-cols-12")}>
          {CARDS.map((c, i) => {
            const Icon = c.icon;
            return (
              <Reveal key={c.slug} delay={i * 50} className={clsx(SLIDE, c.span)}>
                <Link href={`/features/${c.slug}`} className={clsx("group relative flex h-full flex-col overflow-hidden rounded-[28px] ring-1 ring-fg/[0.06] transition-[transform,box-shadow] duration-500 hover:-translate-y-1 hover:shadow-[0_30px_60px_-30px_rgb(30_20_70/0.35)]", TINT_BG[c.tint], c.wide && "lg:flex-row")}>
                  <div className={clsx("relative z-10 flex flex-col gap-3 p-6 sm:p-7", c.wide && "lg:w-[42%] lg:justify-center lg:p-10")}>
                    <span className="flex items-center gap-2.5">
                      <span className={clsx("grid size-10 place-items-center rounded-[13px] bg-white/80 shadow-sm ring-1 ring-fg/[0.05]", TINT_INK[c.tint])}><Icon className="size-[18px]" /></span>
                      <span className="text-[13px] font-semibold tracking-wide text-fg/60 uppercase">{c.label}</span>
                    </span>
                    <h3 data-no-fit className={clsx("leading-[1.12] font-semibold tracking-[-0.025em]", c.tall || c.wide ? "text-[clamp(1.35rem,2.1vw,1.85rem)]" : "text-[19px]")}>{c.title}</h3>
                    <p className="text-[14px] leading-relaxed text-fg/60">{c.body}</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {c.chips.map((x) => <li key={x} className="rounded-full bg-white/70 px-2.5 py-1 text-[12px] font-medium text-fg/70 ring-1 ring-fg/[0.05]">{x}</li>)}
                    </ul>
                    <span className="mt-1 inline-flex items-center gap-1.5 text-[14px] font-semibold">Explore {c.label} <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" /></span>
                  </div>
                  {/* A real screen of the tool, cropped to what matters. */}
                  <div className={clsx("relative mt-auto overflow-hidden", c.wide ? "h-[220px] sm:h-[280px] lg:h-auto lg:min-h-[340px] lg:flex-1" : c.tall ? "h-[220px] sm:h-[300px] lg:h-[340px]" : "h-[200px] sm:h-[240px]")}>
                    <div className={clsx("absolute inset-0 overflow-hidden rounded-tl-[18px] bg-white shadow-[0_20px_50px_-20px_rgb(30_20_70/0.35)] ring-1 ring-fg/[0.06] transition-transform duration-700 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:-translate-y-1.5", c.wide ? "top-6 left-6 lg:top-10 lg:left-0" : "top-0 left-6 sm:left-8")}>
                      <Image src={c.img} alt={c.alt} fill sizes={c.wide ? "(min-width:1024px) 800px, 90vw" : c.tall ? "(min-width:1024px) 700px, 90vw" : "(min-width:1024px) 420px, 90vw"} className="object-cover object-left-top transition-transform duration-700 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:[transform:scale(var(--z-hover))]" style={{ transform: `scale(${c.zoom})`, transformOrigin: c.pos, ["--z-hover" as string]: String(c.zoom * 1.04) }} />
                    </div>
                  </div>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const TINT_BG: Record<Card["tint"], string> = {
  lavender: "bg-[linear-gradient(160deg,var(--p-lavender),color-mix(in_srgb,var(--p-lavender)_30%,white))]",
  sky: "bg-[linear-gradient(160deg,var(--p-sky),color-mix(in_srgb,var(--p-sky)_30%,white))]",
  mint: "bg-[linear-gradient(160deg,var(--p-mint),color-mix(in_srgb,var(--p-mint)_30%,white))]",
  peach: "bg-[linear-gradient(160deg,var(--p-peach),color-mix(in_srgb,var(--p-peach)_30%,white))]",
  butter: "bg-[linear-gradient(160deg,var(--p-butter),color-mix(in_srgb,var(--p-butter)_30%,white))]",
  rose: "bg-[linear-gradient(160deg,var(--p-rose),color-mix(in_srgb,var(--p-rose)_30%,white))]",
};
const TINT_INK: Record<Card["tint"], string> = { lavender: "text-[var(--p-lavender-ink)]", sky: "text-[var(--p-sky-ink)]", mint: "text-[var(--p-mint-ink)]", peach: "text-[var(--p-peach-ink)]", butter: "text-[var(--p-butter-ink)]", rose: "text-[var(--p-rose-ink)]" };
