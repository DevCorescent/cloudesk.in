import { DarkHero } from "@/components/marketing/dark-hero";
import { ArrowRight, BadgeIndianRupee, BarChart3, CalendarClock, Check, Gift, Layers, LineChart, Lock, Repeat, ShieldCheck, Target, Trophy, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Reveal } from "@/components/marketing/interactive";
import { ApplyForm, EarningsCalculator, PartnerTypes } from "@/components/partners/marketing";
import { DashboardTour, HeroDashboard } from "@/components/partners/showcase";
import { pct } from "@/lib/partners/program";
import { getPageSession } from "@/server/auth/page-session";
import { paidPlans } from "@/server/billing/subscriptions";
import { partnerOf, publicProgram } from "@/server/partners/core";

export const metadata: Metadata = {
  title: "Become a partner — Cloudesk",
  description: "Earn a recurring share of what every business you bring to Cloudesk pays. For agencies and IT firms, freelancers, sales and marketing partners and creators — with your own dashboard, codes, tracked links and payouts on request.",
};

const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

const NAV = [
  ["how", "How it works"],
  ["roles", "Ways to partner"],
  ["dashboard", "Your dashboard"],
  ["calculator", "Earnings"],
  ["payouts", "Payouts"],
  ["faq", "Questions"],
] as const;

function Heading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <Reveal className="mb-10 max-w-2xl">
      <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.08] font-[380] tracking-[-0.035em]">{title}</h2>
      {sub && <p className="mt-3 text-[16px] leading-relaxed text-fg/60">{sub}</p>}
    </Reveal>
  );
}

export default async function PartnersPage() {
  const [program, plans, session] = await Promise.all([publicProgram(), paidPlans(), getPageSession()]);
  const mine = session ? await partnerOf(session.user.id) : null;
  const origin = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const topBonus = Math.max(0, ...program.tiers.map((t) => t.bonusBps));
  const topRate = Math.max(...program.types.map((t) => t.commissionBps)) + topBonus;
  const longest = Math.max(...program.types.map((t) => t.commissionMonths));
  const discounts = program.types.map((t) => t.discountBps);
  const calcPlans = plans.filter((p) => p.monthly > 0 && p.kind !== "basic").map((p) => ({ id: p.id, name: p.name, monthly: p.monthly }));

  const KEY = [
    { big: `Up to ${pct(topRate)}`, line: "of what every customer pays" },
    { big: longest ? `${longest} months` : "For life", line: "of earnings from each customer" },
    { big: Math.min(...discounts) === Math.max(...discounts) ? `${pct(Math.max(...discounts))} off` : `${pct(Math.min(...discounts))}–${pct(Math.max(...discounts))} off`, line: "for the customers you bring" },
    { big: rupees(program.minPayout), line: "smallest payout, by UPI or bank" },
  ];

  const STEPS = [
    { n: "1", title: "Apply", body: "Pick how you'd like to partner and tell us about your work. Five minutes, free." },
    { n: "2", title: "Get approved", body: "We review every application, usually within 2 working days, and email you." },
    { n: "3", title: "Share", body: "Send your link or code to clients, followers or your network. Register the deals you're working." },
    { n: "4", title: "Earn", body: `Every payment they make earns you your share. After ${program.holdDays} days, withdraw it.` },
  ];

  const BENEFITS = [
    { icon: Repeat, title: "Paid every month, not once", body: "Renewals and upgrades earn too — your income grows as your customers stay." },
    { icon: Gift, title: "A discount that sells", body: "Your code takes money off your customers' first payments, automatically." },
    { icon: Layers, title: "One product, every business", body: "Website, store, GST billing, CRM, POS, stock, HR — every business you meet is a fit." },
    { icon: CalendarClock, title: "Free to try for 30 days", body: "No one has to pay to start, so saying yes is easy." },
    { icon: BarChart3, title: "Numbers you can check", body: "Every customer, invoice and rate is in your dashboard as it happens." },
    { icon: Target, title: "Your deals stay yours", body: `Registered leads are protected for ${program.leadDays} days.` },
  ];

  const FAQ: [string, string][] = [
    ["Who can become a partner?", "Agencies, IT and implementation firms, chartered accountants and consultants, resellers, freelancers, sales professionals, marketers, publishers and creators. You don't need to be a company — individuals are welcome."],
    ["How much does it cost to join?", "Nothing. There's no fee, no minimum target and no stock to buy."],
    ["What exactly do I earn?", "A share of what each customer you bring pays Cloudesk, before tax — first payments, renewals and upgrades — for the window shown for your kind of partner. If a payment is refunded or found to be fraudulent, the commission on it is cancelled."],
    ["How do customers become mine?", `Any of three ways: they sign up after visiting through your link (remembered for ${program.cookieDays} days), they enter your code when signing up or later in Billing, or they sign up with the email of a lead you registered. One partner per customer — the first one wins.`],
    ["When and how do I get paid?", `Each commission is held for ${program.holdDays} days after the customer pays, then you can ask for a payout from ${rupees(program.minPayout)}. We check it, send it by UPI, bank transfer or wire, and email you the reference.`],
    ["Is tax deducted?", "Where the law requires it (in India, TDS on commission under section 194H), it's withheld from the payout and shown on it. You're responsible for declaring your earnings and, if registered, charging GST on your services."],
    ["Are the numbers in the dashboard pictures real?", "They're an example partner with sample numbers, to show what the dashboard looks like. What you earn depends on the customers you bring and what they pay."],
    ["Can I earn on my own business?", "No — your own workspaces don't earn commission. Use a workspace as a demo for your clients any time."],
    ["What's not allowed?", "Bidding on the Cloudesk name in search ads, posing as Cloudesk, spam, fake reviews, and promises Cloudesk doesn't make. Paid posts must be marked as ads or partnerships."],
  ];

  return (
    <>
      {/* Hero */}
      <DarkHero tint="butter" className="pt-10 pb-8 lg:pt-14">
        <section className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-w-0">
            <p className="p-in inline-flex items-center gap-2 rounded-full bg-fg/[0.06] px-3 py-1 text-[12.5px] font-medium text-fg/70 ring-1 ring-fg/[0.1]"><span className="size-1.5 rounded-full bg-[var(--p-mint-ink)]" />Cloudesk Partner Program</p>
            <h1 className="p-in mt-5 text-[clamp(2.3rem,5vw,4.2rem)] leading-[1.04] font-[360] tracking-[-0.045em]" style={{ animationDelay: "80ms" }}>
              Recommend Cloudesk. <span className="mk-logo-gradient">Earn every month.</span>
            </h1>
            <p className="p-in mt-5 max-w-xl text-[17px] leading-relaxed text-fg/60" style={{ animationDelay: "160ms" }}>
              Bring businesses to Cloudesk and earn a share of everything they pay — every month, {longest ? `for up to ${longest} months` : "for as long as they stay"}. For agencies, freelancers, sales and marketing partners and creators.
            </p>
            <div className="p-in mt-7 flex flex-wrap gap-3" style={{ animationDelay: "220ms" }}>
              <a href="#apply" className="p-cta lx-sheen inline-flex items-center gap-2 px-7">Become a partner <ArrowRight className="size-4" /></a>
              <a href="#calculator" className="inline-flex h-12 items-center gap-2 rounded-full bg-fg/[0.06] px-6 text-[15px] font-medium ring-1 ring-fg/[0.12] transition-colors hover:bg-fg/[0.1]">What could I earn?</a>
            </div>
            <ul className="p-in mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-fg/60" style={{ animationDelay: "280ms" }}>
              {["Free to join", "No targets", "Your own dashboard"].map((x) => <li key={x} className="inline-flex items-center gap-1.5"><Check className="size-4 text-emerald-400" />{x}</li>)}
            </ul>
          </div>
          <div className="p-in min-w-0" style={{ animationDelay: "200ms" }}>
            <div className="mk-keep-light"><HeroDashboard origin={origin} /></div>
          </div>
        </section>
      </DarkHero>
    <div className="mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-14 xl:px-20">

      {/* The program in four numbers */}
      <section aria-label="The program at a glance" className="mt-16 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KEY.map((k) => (
          <div key={k.line} className="rounded-[22px] border border-fg/[0.06] bg-white/70 p-5 sm:p-6">
            <p className="text-[clamp(1.35rem,2.6vw,2.1rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums">{k.big}</p>
            <p className="mt-2 text-[13.5px] leading-snug text-fg/55">{k.line}</p>
          </div>
        ))}
      </section>

      {/* Find your way around */}
      <nav aria-label="On this page" className="sticky top-16 z-20 -mx-5 mt-12 border-y border-fg/[0.05] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] px-5 backdrop-blur-xl sm:-mx-8 sm:px-8 lg:-mx-14 lg:px-14 xl:-mx-20 xl:px-20">
        <div className="flex items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {NAV.map(([id, label]) => <a key={id} href={`#${id}`} className="shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium text-fg/60 transition-colors hover:bg-fg/[0.05] hover:text-fg">{label}</a>)}
          <a href="#apply" className="ml-auto shrink-0 rounded-full bg-fg px-4 py-1.5 text-[13.5px] font-medium text-bg">Apply</a>
        </div>
      </nav>

      {/* How it works */}
      <section id="how" className="mt-20 scroll-mt-36">
        <Heading eyebrow="How it works" title="Four steps. That's it." sub="No contracts to negotiate, no stock, no targets. Share Cloudesk with businesses that need it and get paid on what they pay." />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.n} delay={i * 60} className="relative rounded-[24px] border border-fg/[0.06] bg-white/70 p-6">
              <span className="grid size-9 place-items-center rounded-full bg-fg text-[14px] font-semibold text-bg">{s.n}</span>
              <h3 data-no-fit className="mt-4 text-[18px] font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-fg/60">{s.body}</p>
              {i < STEPS.length - 1 && <ArrowRight className="absolute top-8 -right-3 z-10 hidden size-5 text-fg/25 lg:block" aria-hidden />}
            </Reveal>
          ))}
        </ol>
      </section>

      {/* Ways to partner */}
      <section id="roles" className="mt-28 scroll-mt-36">
        <Heading eyebrow="Ways to partner" title="Pick the role that fits you." sub="Each has its own scope of work, its own rates and a dashboard built around how you work. Choose one to see the details." />
        <PartnerTypes program={program} />
      </section>

      {/* Your dashboard */}
      <section id="dashboard" className="mt-28 scroll-mt-36">
        <Heading eyebrow="Your partner dashboard" title="See every rupee you earn." sub="Once you're approved you get a dashboard of your own: customers, earnings, links, codes, leads and payouts — updated as it happens." />
        <DashboardTour origin={origin} />
      </section>

      {/* Calculator */}
      <section id="calculator" className="mt-28 scroll-mt-36">
        <Heading eyebrow="Earnings calculator" title="What could you earn?" sub="Move the slider to see a year of earnings at today's rates." />
        <EarningsCalculator program={program} plans={calcPlans} />
      </section>

      {/* Why */}
      <section className="mt-28">
        <Heading eyebrow="Why partners choose Cloudesk" title="Easy to sell. Built to keep paying." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 40} className="flex gap-4 rounded-[24px] border border-fg/[0.06] bg-white/70 p-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--p-lavender)] text-[var(--p-lavender-ink)]"><Icon className="size-5" /></span>
              <span>
                <h3 data-no-fit className="text-[17px] font-semibold tracking-tight">{title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-fg/60">{body}</p>
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Tiers and payouts */}
      <section id="payouts" className="mt-28 grid scroll-mt-36 grid-cols-1 gap-6 lg:grid-cols-2">
        <Reveal className="rounded-[28px] border border-fg/[0.06] bg-white/70 p-6 sm:p-8">
          <span className="grid size-11 place-items-center rounded-[14px] bg-[var(--p-butter)] text-[var(--p-butter-ink)]"><Trophy className="size-5" /></span>
          <h2 data-no-fit className="mt-4 text-[26px] font-semibold tracking-tight">Earn more as you grow</h2>
          <p className="mt-1.5 text-[14.5px] text-fg/60">Your tier depends on how many of your customers are paying. A higher tier lifts the rate on <b className="text-fg/80">every</b> customer, not just new ones.</p>
          <div className="mt-5 grid gap-2">
            {[...program.tiers].sort((a, b) => a.minActive - b.minActive).map((t) => (
              <div key={t.name} className="flex items-center justify-between rounded-[16px] bg-white px-4 py-3 ring-1 ring-fg/[0.05]">
                <span><b className="text-[15px]">{t.name}</b><span className="ml-2 text-[13px] text-fg/50">{t.minActive ? `${t.minActive}+ paying customers` : "From your first customer"}</span></span>
                <span className="text-[15px] font-semibold tabular-nums">{t.bonusBps ? `+${pct(t.bonusBps)}` : "Base rate"}</span>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={80} className="rounded-[28px] border border-fg/[0.06] bg-white/70 p-6 sm:p-8">
          <span className="grid size-11 place-items-center rounded-[14px] bg-[var(--p-mint)] text-[var(--p-mint-ink)]"><BadgeIndianRupee className="size-5" /></span>
          <h2 data-no-fit className="mt-4 text-[26px] font-semibold tracking-tight">Getting paid is simple</h2>
          <ol className="mt-5 grid gap-4">
            {[
              { icon: LineChart, t: "A customer pays", b: "Your share appears in your dashboard straight away, with the invoice and the rate." },
              { icon: CalendarClock, t: `${program.holdDays} days later`, b: "It moves from on hold to available." },
              { icon: Wallet, t: "You ask for a payout", b: `Any amount from ${rupees(program.minPayout)} — to UPI, a bank account in India, or an international wire.` },
              { icon: ShieldCheck, t: "We send it", b: "You're emailed the transfer reference. Tax withheld at source, if any, is shown on the payout." },
            ].map(({ icon: I, t, b }) => (
              <li key={t} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white ring-1 ring-fg/[0.06]"><I className="size-4 text-fg/55" /></span>
                <span><b className="block text-[15px]">{t}</b><span className="text-[14px] text-fg/60">{b}</span></span>
              </li>
            ))}
          </ol>
          <p className="mt-5 flex items-center gap-1.5 text-[12.5px] text-fg/50"><Lock className="size-3.5" />Bank and UPI details are stored encrypted; only the last digits are ever shown.</p>
        </Reveal>
      </section>

      {/* Apply */}
      <section id="apply" className="mt-28 scroll-mt-36">
        <Heading eyebrow="Apply" title="Become a partner today." sub={`Five minutes, free, and no commitment. ${session ? "You're signed in, so your application goes with this account." : "We'll make you a partner account — you'll confirm your email with a code."}`} />
        <ApplyForm signedIn={session ? { name: session.user.name, email: session.user.email } : null} existing={mine ? { status: mine.status, type: mine.type as never } : null} open={program.open} termsHref="/partner-terms" />
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto mt-28 max-w-3xl scroll-mt-36">
        <h2 className="text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.08] font-[380] tracking-[-0.035em]">Questions partners ask</h2>
        <div className="mt-6 divide-y divide-fg/[0.07] border-y border-fg/[0.07]">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium marker:hidden">{q}<span className="text-[20px] leading-none text-fg/35 transition-transform group-open:rotate-45" aria-hidden>+</span></summary>
              <p className="mt-2 text-[15px] leading-relaxed text-fg/60">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-[13.5px] text-fg/50">Read the full <a href="/partner-terms" className="font-medium text-fg underline underline-offset-2">Partner Terms</a>.</p>
      </section>
    </div>
    </>
  );
}
