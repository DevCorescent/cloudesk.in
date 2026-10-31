// Homepage sections below the main story: who it's for, what it connects to,
// why one place beats five apps, and common questions. Photos are Unsplash
// (free licence), checked by hand; integrations listed here all exist in the
// product and connect with the business's own accounts.
import clsx from "clsx";
import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import Image from "next/image";
import { ShotFrame } from "./shot-tour";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand";
import { BUSINESSES } from "./businesses";
import { FitLine, Mark, Reveal } from "./interactive";

/** Full-width content with generous side margins. */
export const W = "mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-14 xl:px-20";
/**
 * Cards that are a grid on large screens and a swipeable row on phones and
 * tablets (each card snaps into place, the next one peeking in). Add the
 * large-screen columns, e.g. clsx(SLIDER, "lg:grid-cols-3"), and SLIDE on each card.
 */
export const SLIDER = "-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-5 px-5 pb-4 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:mx-0 lg:grid lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden";
export const SLIDE = "w-[84%] shrink-0 snap-start sm:w-[58%] md:w-[44%] lg:w-auto";
/** Sleek headings: large, light weight, tight tracking. */
export const H2 = "text-[clamp(2rem,4.4vw,3.8rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance";

export function Eyebrow({ n, children, tone, center }: { n?: string; children: ReactNode; tone: string; center?: boolean }) {
  return (
    <p className={clsx("flex items-center gap-3 text-[13px] font-medium text-fg/55", center && "justify-center")}>
      {n ? (
        <span className="grid size-8 place-items-center rounded-full text-[12px] font-semibold" style={{ background: `var(--p-${tone})`, color: `var(--p-${tone}-ink)` }}>{n}</span>
      ) : (
        <span className="size-2 rounded-full" style={{ background: `var(--p-${tone}-ink)` }} />
      )}
      {children}
    </p>
  );
}

const photo = (id: string, w = 800) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export function Businesses() {
  return (
    <section className="relative py-16 sm:py-24">
      <div className={W}>
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-5xl">
            <Eyebrow tone="peach">Who it&apos;s for</Eyebrow>
            <h2 className={clsx(H2, "mt-5")}><FitLine>Made for <Mark tone="peach">businesses like yours</Mark>.</FitLine></h2>
          </div>
          <div className="max-w-sm">
            <p className="text-[16px] leading-relaxed text-fg/55">Tell us what you do. We set up the parts you need — and leave out the ones you don&apos;t.</p>
            <Link href="/for" className="mt-3 inline-flex items-center gap-1 text-[14px] font-medium">See how each one works <ArrowRight className="size-4" /></Link>
          </div>
        </Reveal>
      </div>
      {/* Swipes sideways on phones and tablets; a grid on wide screens. */}
      <div className="mt-12 overflow-x-auto [scrollbar-width:none] lg:overflow-visible [&::-webkit-scrollbar]:hidden">
        <ul className={clsx(W, "flex w-max snap-x snap-mandatory gap-4 lg:grid lg:w-full lg:grid-cols-3 lg:gap-5")}>
          {BUSINESSES.map((b, i) => (
            <li key={b.slug} className="w-[72vw] max-w-[320px] shrink-0 snap-start sm:w-[44vw] lg:w-auto lg:max-w-none">
              <Reveal delay={(i % 3) * 80} className="h-full">
                <Link href={`/for/${b.slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded-[26px] bg-fg/[0.04] lg:aspect-[16/11]">
                  <Image src={photo(b.photo)} alt={b.alt} fill sizes="(min-width: 1024px) 31vw, (min-width: 640px) 44vw, 72vw" className="object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.05]" />
                  <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0)_35%,rgb(0_0_0/0.72))]" />
                  <div className="absolute inset-x-4 bottom-4 sm:inset-x-5 sm:bottom-5">
                    <p className="flex items-center justify-between gap-2 text-[19px] font-medium tracking-[-0.02em] text-white sm:text-[21px]">
                      {b.name}
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 opacity-0 ring-1 ring-white/25 backdrop-blur-md transition-all duration-500 group-hover:translate-x-0 group-hover:opacity-100 lg:-translate-x-2">
                        <ArrowRight className="size-4" />
                      </span>
                    </p>
                    <ul className="mt-2.5 flex flex-wrap gap-1.5">
                      {b.uses.map((u) => (
                        <li key={u} className="rounded-full bg-white/18 px-2.5 py-1 text-[11.5px] font-medium text-white ring-1 ring-white/25 backdrop-blur-md">{u}</li>
                      ))}
                    </ul>
                  </div>
                </Link>
              </Reveal>
            </li>
          ))}
          {/* Keeps the last card clear of the screen edge while scrolling. */}
          <li aria-hidden className="w-1 shrink-0 lg:hidden" />
        </ul>
      </div>
    </section>
  );
}

const HUB = [
  { name: "Razorpay", x: 50, y: 12, tone: "sky" },
  { name: "Stripe", x: 78, y: 22, tone: "lavender" },
  { name: "PayPal", x: 86, y: 50, tone: "sky" },
  { name: "Shiprocket", x: 78, y: 78, tone: "peach" },
  { name: "WhatsApp", x: 50, y: 88, tone: "mint" },
  { name: "Slack", x: 22, y: 78, tone: "rose" },
  { name: "Mailchimp", x: 14, y: 50, tone: "butter" },
  { name: "Webhooks", x: 22, y: 22, tone: "lavender" },
  { name: "Discord", x: 66, y: 32, tone: "lavender" },
  { name: "Telegram", x: 66, y: 68, tone: "sky" },
  { name: "Google feed", x: 34, y: 68, tone: "butter" },
  { name: "REST API", x: 34, y: 32, tone: "mint" },
];

const GROUPS = [
  { title: "Payments", names: "Razorpay · Stripe · PayPal · Cash on delivery", line: "Cards, UPI and wallets — paid straight into your own account.", tone: "mint" },
  { title: "Shipping", names: "Shiprocket", line: "Book pickups and send tracking links without copy-paste.", tone: "peach" },
  { title: "Customer messages", names: "WhatsApp Business", line: "Order confirmations, shipping updates and cart reminders.", tone: "mint" },
  { title: "Team alerts", names: "Slack · Discord · Telegram", line: "A ping for every paid order, booking and form.", tone: "lavender" },
  { title: "Marketing", names: "Mailchimp · Google Merchant · Meta catalog", line: "Sync customers and list your products on shopping channels.", tone: "butter" },
  { title: "For developers", names: "Webhooks · REST API · Apps", line: "Signed events and an open, documented API.", tone: "sky" },
];

export function Integrations() {
  return (
    <section className="relative py-16 sm:py-24">
      <div className={W}>
        <div className="relative overflow-hidden rounded-[36px] px-5 py-12 ring-1 ring-fg/[0.06] sm:rounded-[44px] sm:px-10 sm:py-16 lg:px-14" style={{ background: "radial-gradient(60% 70% at 85% 30%, color-mix(in srgb, var(--tint-sky) 80%, transparent), transparent 70%), radial-gradient(50% 60% at 10% 90%, color-mix(in srgb, var(--tint-lavender) 75%, transparent), transparent 70%), var(--surface-solid)" }}>
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Reveal>
                <Eyebrow tone="sky">Integrations</Eyebrow>
                <h2 className={clsx(H2, "mt-5")}><FitLine>Works with <Mark tone="sky">your tools</Mark>.</FitLine></h2>
                <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-fg/55">Connect with your own accounts in a few clicks. Keys are checked when you connect and stored encrypted.</p>
              </Reveal>
              <ul className="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {GROUPS.map((g, i) => (
                  <Reveal as="li" key={g.title} delay={(i % 2) * 80}>
                    <div className={clsx("h-full rounded-[20px] bg-[var(--surface-solid)]/80 p-4 ring-1 ring-fg/[0.06] backdrop-blur", `tint-${g.tone}`)}>
                      <p className="flex items-center gap-2 text-[15px] font-medium"><span className="size-2 rounded-full bg-[var(--t-ink)]" /> {g.title}</p>
                      <p className="mt-1 text-[12.5px] font-medium text-fg/70">{g.names}</p>
                      <p className="mt-1.5 text-[13px] leading-snug text-fg/50">{g.line}</p>
                    </div>
                  </Reveal>
                ))}
              </ul>
            </div>

            {/* The hub: everything plugged into one place. */}
            <Reveal delay={120}>
              <div aria-hidden className="relative mx-auto aspect-square w-full max-w-[560px] select-none">
                <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible">
                  <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeOpacity="0.08" vectorEffect="non-scaling-stroke" />
                  <circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" strokeOpacity="0.08" vectorEffect="non-scaling-stroke" />
                  {HUB.map((h) => (
                    <line key={h.name} x1="50" y1="50" x2={h.x} y2={h.y} stroke={`var(--p-${h.tone}-ink)`} strokeOpacity="0.45" strokeWidth="1.2" vectorEffect="non-scaling-stroke" className="mk-dash" style={{ animationDuration: "6s" }} />
                  ))}
                </svg>
                <div className="absolute top-1/2 left-1/2 grid size-[22%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[28%] bg-fg text-bg shadow-[0_30px_60px_-24px_rgb(0_0_0/0.5)]">
                  <LogoMark className="size-1/2" />
                </div>
                {HUB.map((h) => (
                  <span
                    key={h.name}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-[var(--surface-solid)] py-1 pr-2.5 pl-1 text-[clamp(9.5px,1.6vw,12.5px)] font-medium whitespace-nowrap shadow-[0_10px_24px_-14px_rgb(0_0_0/0.35)] ring-1 ring-fg/[0.07]"
                    style={{ left: `${h.x}%`, top: `${h.y}%` }}
                  >
                    <span className="grid size-[1.9em] place-items-center rounded-full text-[0.85em] font-semibold" style={{ background: `var(--p-${h.tone})`, color: `var(--p-${h.tone}-ink)` }}>{h.name[0]}</span>
                    {h.name}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

const BEFORE = ["A website builder", "A separate store app", "A billing machine", "An invoicing tool", "A booking app", "Spreadsheets for dues"];
const AFTER = ["One login for everything", "One stock — online and at the counter", "One set of real numbers", "One bill"];

export function OnePlace() {
  return (
    <section className="relative py-16 sm:py-24">
      <div className={W}>
        <Reveal className="max-w-5xl">
          <Eyebrow tone="rose">Why switch</Eyebrow>
          <h2 className={clsx(H2, "mt-5")}><FitLine>One place, not <Mark tone="rose" kind="underline">five apps</Mark>.</FitLine></h2>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Reveal>
            <div className="relative h-full overflow-hidden rounded-[30px] bg-fg/[0.03] p-6 ring-1 ring-fg/[0.06] sm:p-9">
              <p className="text-[13px] font-semibold tracking-wider text-fg/40 uppercase">Today</p>
              <ul className="mt-6 flex flex-wrap gap-2.5">
                {BEFORE.map((b, i) => (
                  <li key={b} className="flex items-center gap-2 rounded-[14px] bg-[var(--surface-solid)] px-3.5 py-2.5 text-[14px] text-fg/55 shadow-[0_8px_20px_-14px_rgb(0_0_0/0.3)] ring-1 ring-fg/[0.06]" style={{ rotate: `${[-2, 1.5, -1, 2, -1.5, 1][i]}deg` }}>
                    <Minus className="size-3.5 text-fg/35" /> {b}
                  </li>
                ))}
              </ul>
              <p className="mt-8 max-w-sm text-[15px] leading-relaxed text-fg/50">Six logins, stock that never matches, and numbers you add up by hand.</p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="fin-hero relative h-full overflow-hidden rounded-[30px] p-6 ring-1 ring-fg/[0.06] sm:p-9">
              <p className="flex items-center gap-2 text-[13px] font-semibold tracking-wider text-fg/55 uppercase"><LogoMark className="size-4" /> With Cloudesk</p>
              <ul className="mt-6 grid gap-3">
                {AFTER.map((a) => (
                  <li key={a} className="flex items-center gap-3 text-[clamp(1.05rem,1.6vw,1.3rem)] font-medium tracking-[-0.015em]">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg text-bg"><Check className="size-3.5" strokeWidth={3} /></span>
                    {a}
                  </li>
                ))}
              </ul>
              <Link href="/start" className="p-cta mt-9 inline-flex items-center gap-2 px-7">Start free <ArrowRight className="size-4" /></Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  ["Do I need to know code or design?", "No. Describe your business and we draft the whole site. After that, you edit by clicking and dragging — like a document."],
  ["Can I use my own domain?", "Yes, on the Pro and Business plans. Connect a domain you already own — we check the DNS records and tell you exactly what to change. Or keep the free address we give you."],
  ["How do I get paid?", "Connect your own Razorpay, Stripe or PayPal account, or take cash on delivery. Money goes straight to you — we never hold it."],
  ["Can I use invoicing without a website?", "Yes. Finance works on its own: GST invoices, quotations, payments and reports, with or without a store."],
  ["Is there a free plan?", "Yes, and no card is needed to start. Upgrade only when you want more."],
  ["Can I take my data with me?", "Any time. Products, orders, customers and invoices export as CSV."],
];

export function Faq() {
  return (
    <section className="relative py-16 sm:py-24">
      <div className={clsx(W, "grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20")}>
        <Reveal>
          <Eyebrow tone="butter">Questions</Eyebrow>
          <h2 className={clsx(H2, "mt-5")}><FitLine>Good <Mark tone="butter">to know</Mark>.</FitLine></h2>
          <p className="mt-5 max-w-sm text-[16px] leading-relaxed text-fg/55">Short answers to what most people ask first.</p>
        </Reveal>
        <Reveal delay={100}>
          <ul className="divide-y divide-fg/[0.08] border-y border-fg/[0.08]">
            {FAQS.map(([q, a]) => (
              <li key={q}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium tracking-[-0.01em] sm:text-[19px] [&::-webkit-details-marker]:hidden">
                    {q}
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-fg/[0.05] transition-transform duration-300 group-open:rotate-45">
                      <Plus className="size-4" />
                    </span>
                  </summary>
                  <p className="max-w-2xl pb-6 text-[15.5px] leading-relaxed text-fg/60">{a}</p>
                </details>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}


type Pic = { src: string; w: number; h: number; alt: string };
const FLOW: { title: string; line: string; tone: string; pic: Pic }[] = [
  { title: "Add a product once", line: "Photo, price, stock — that's it.", tone: "peach", pic: { src: "/marketing/store/products.jpg", w: 2880, h: 1800, alt: "The product list with photos, stock and prices" } },
  { title: "Sell it online or at the counter", line: "Both draw from the same stock.", tone: "mint", pic: { src: "/marketing/pos/grid-panel.jpg", w: 2070, h: 1060, alt: "The till's product tiles showing how many are left" } },
  { title: "Every sale gets a GST invoice", line: "One numbering series, online and in-store.", tone: "sky", pic: { src: "/marketing/pos/receipt.jpg", w: 840, h: 1160, alt: "A receipt with the CGST and SGST split" } },
  { title: "The day adds itself up", line: "Cash, UPI and card, ready to count.", tone: "butter", pic: { src: "/marketing/pos/today-panel.jpg", w: 1204, h: 1560, alt: "Today's takings split by cash, UPI and card" } },
];
const SHARED = ["One stock", "One customer list", "One order history", "One GST invoice series", "One login for your team"];

/** How the parts work as one: a product's journey, with real screens. */
export function Connected() {
  return (
    <section className="relative py-16 sm:py-24">
      <div className={W}>
        <Reveal className="mx-auto max-w-5xl text-center">
          <Eyebrow tone="mint" center>Sell</Eyebrow>
          <h2 className={clsx(H2, "mt-5")}><FitLine>One sale. <Mark tone="mint">Zero copy-paste.</Mark></FitLine></h2>
          <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-fg/55">Your website and your shop counter are the same store underneath — so a sale shows up everywhere it should, on its own.</p>
        </Reveal>
        <ol className="relative mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <span aria-hidden className="pointer-events-none absolute top-[120px] right-[12%] left-[12%] hidden h-px lg:block" style={{ backgroundImage: "linear-gradient(90deg, color-mix(in srgb, var(--fg) 22%, transparent) 50%, transparent 50%)", backgroundSize: "10px 1px" }} />
          {FLOW.map((f, i) => (
            <Reveal as="li" key={f.title} delay={i * 110} className="relative">
              <div className="flex h-full flex-col overflow-hidden rounded-[28px] bg-[var(--surface-solid)] ring-1 ring-fg/[0.06] shadow-[0_30px_60px_-40px_rgb(30_20_70/0.35)]">
                <div className="relative grid h-[240px] place-items-center p-4" style={{ background: `linear-gradient(160deg, color-mix(in srgb, var(--p-${f.tone}) 70%, var(--surface-solid)), var(--surface-solid))` }}>
                  <Image src={f.pic.src} alt={f.pic.alt} width={f.pic.w} height={f.pic.h} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" className="h-auto max-h-[208px] w-auto max-w-full rounded-[12px] shadow-[0_16px_34px_-18px_rgb(0_0_0/0.4)] ring-1 ring-black/5" />
                </div>
                <div className="flex items-start gap-3 p-5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums" style={{ background: `var(--p-${f.tone})`, color: `var(--p-${f.tone}-ink)` }}>{i + 1}</span>
                  <span>
                    <span className="block text-[16.5px] leading-snug font-medium tracking-[-0.015em]">{f.title}</span>
                    <span className="mt-1 block text-[13.5px] text-fg/55">{f.line}</span>
                  </span>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
        <Reveal className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
          <span className="mr-1 text-[13px] font-medium text-fg/45">Shared by everything:</span>
          {SHARED.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-solid)] px-3.5 py-1.5 text-[13px] font-medium ring-1 ring-fg/[0.07]">
              <Check className="size-3.5 text-[var(--p-mint-ink)]" strokeWidth={2.5} /> {s}
            </span>
          ))}
        </Reveal>
        <Reveal className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px] font-medium">
          <Link href="/features/online-store" className="inline-flex items-center gap-1">The online store <ArrowRight className="size-4" /></Link>
          <Link href="/features/point-of-sale" className="inline-flex items-center gap-1">Point of sale & labels <ArrowRight className="size-4" /></Link>
        </Reveal>
      </div>
    </section>
  );
}

/** Finance, presented as part of the same app. */
export function FinanceNextDoor() {
  return (
    <section className="relative py-16 sm:py-24">
      <div className={clsx(W, "grid grid-cols-1 items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16")}>
        <Reveal>
          <Eyebrow tone="butter">Get paid</Eyebrow>
          <h2 className={clsx(H2, "mt-5")}><FitLine>Finance, <Mark tone="butter">right next door.</Mark></FitLine></h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-fg/55">Quotes, GST invoices and payments — in the same app, with the same login and team. Use it alongside your store, or entirely on its own.</p>
          <ul className="mt-7 grid max-w-lg gap-3">
            {["CGST, SGST or IGST, worked out for you", "A Pay-by-UPI button on every invoice", "See who owes what — and nudge them on WhatsApp"].map((x) => (
              <li key={x} className="flex items-start gap-3 text-[15.5px]">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--p-butter)] text-[var(--p-butter-ink)]"><Check className="size-3" strokeWidth={3} /></span>
                {x}
              </li>
            ))}
          </ul>
          <Link href="/features/invoicing" className="p-cta mt-9 inline-flex items-center gap-2 px-7">Explore Finance <ArrowRight className="size-4" /></Link>
        </Reveal>
        <Reveal delay={120}>
          <div className="relative grid grid-cols-[1fr_22%] items-end gap-4 sm:gap-6">
            <span aria-hidden className="pointer-events-none absolute inset-[6%] -z-10 rounded-full opacity-80 blur-3xl" style={{ background: "radial-gradient(closest-side, var(--p-butter), transparent)" }} />
            <ShotFrame shot={{ src: "/marketing/finance/overview.jpg", w: 2880, h: 1800, alt: "The Finance overview with what you're owed and a 12-month chart" }} sizes="(min-width: 1024px) 45vw, 75vw" />
            <ShotFrame shot={{ src: "/marketing/finance/phone.jpg", w: 1170, h: 1899, alt: "A client's invoice on a phone with a Pay by UPI button" }} bare sizes="15vw" className="rounded-[16px]! ring-[4px] ring-fg sm:rounded-[24px]! sm:ring-[6px]" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
