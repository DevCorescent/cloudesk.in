import clsx from "clsx";
import { ArrowRight, ArrowUpRight, Check, FileLock2, Fingerprint, KeyRound, Lock, ScrollText, ShieldCheck, UserCog } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { HomeHero, WorkdaySection } from "@/components/marketing/home";
import { FitLine, Mark, Reveal } from "@/components/marketing/interactive";
import { groupFeatures, PRODUCT_GROUPS, shortName } from "@/components/marketing/nav";
import { PhoneDeck } from "@/components/marketing/phone-deck";
import { Businesses, Faq, H2, Integrations, SLIDE, SLIDER, W } from "@/components/marketing/sections";
import { HorecaSpotlight } from "@/components/marketing/horeca-spotlight";
import { IntelligenceHighlight } from "@/components/marketing/intelligence";
import { Innovations } from "@/components/marketing/innovations";
import { DocumentsSpotlight } from "@/components/marketing/documents-spotlight";
import { NotesSpotlight, PartnersSpotlight, WorkdayCards } from "@/components/marketing/home-spotlights";
import { publicProgram } from "@/server/partners/core";
import { SiteJsonLd } from "@/components/legal/json-ld";
import { MobileIntro } from "@/components/marketing/mobile-intro";
import { getPageSession } from "@/server/auth/page-session";

export const metadata: Metadata = {
  title: "Cloudesk — your website, store and business software, ready in minutes",
  description: "Create your website, open an online store and run your business — sales, invoices, accounts, HR and stock — on one platform, set up in minutes.",
};

const Eyebrow = ({ children, light }: { children: ReactNode; light?: boolean }) => <p className={clsx("text-[12px] font-semibold tracking-[0.18em] uppercase", light ? "text-white/50" : "text-fg/45")}>{children}</p>;

/** Three things you launch, each with what's included. */
const PILLARS = [
  { title: "Your website", tone: "lavender", href: "/features/website-builder", img: "/marketing/builder/overview.jpg", alt: "The website builder with a page being edited", points: ["26 industry templates, 11 design styles", "Drag and drop sections; click any word to edit", "Separate styles for phones and tablets", "Your own domain, SEO and fast pages"] },
  { title: "Your online store", tone: "peach", href: "/features/online-store", img: "/marketing/store/products.jpg", alt: "The products list of an online store", points: ["Products, variants, stock and checkout", "UPI, cards and cash on delivery", "Orders, invoices, returns and shipping", "One stock with your shop counter (POS)"] },
  { title: "Your business software", tone: "mint", href: "/features", img: "/marketing/home/dashboard.jpg", alt: "The business dashboard", points: ["CRM, sales, invoicing and accounts with GST", "HR, payroll, projects and timesheets", "Inventory, purchasing and manufacturing", "Switch on only what you need"] },
] as const;

/** The newest features, each with a real screen. */
const NEW: { title: string; body: string; img: string; w: number; h: number; alt: string; href: string; span: string; pos?: string }[] = [
  { title: "Drag, drop, done", body: "Move any section by its handle or drag one in from the gallery — the page shows exactly where it'll land.", img: "/marketing/builder/dragdrop.jpg", w: 2880, h: 1800, alt: "Moving a section in the builder, with a 'Move here' line", href: "/features/website-builder", span: "lg:col-span-4", pos: "50% 18%" },
  { title: "A live dashboard for the whole business", body: "Money owed, pipeline, shop sales, who's in today and stock to reorder — with what needs attention first.", img: "/marketing/home/dashboard.jpg", w: 2880, h: 1800, alt: "The business dashboard", href: "/start", span: "lg:col-span-2", pos: "60% 30%" },
  { title: "Your site, wired to your business", body: "Forms become CRM contacts, a support form opens Helpdesk tickets, and open jobs and events appear by themselves.", img: "/marketing/builder/connect.jpg", w: 2880, h: 1800, alt: "The Connect panel in the builder", href: "/features/website-builder", span: "lg:col-span-2", pos: "0% 20%" },
  { title: "Publish anywhere", body: "Keep it hosted here, or publish the same site to GitHub, Netlify, Vercel or Cloudflare Pages in one click.", img: "/marketing/builder/publish-card.jpg", w: 1728, h: 964, alt: "Hosting & publishing: this platform, GitHub, Netlify, Vercel and Cloudflare Pages", href: "/features/domains", span: "lg:col-span-2", pos: "0% 0%" },
  { title: "Find anything", body: "Pages, people, deals, items and invoices from one search box — a keyboard shortcut (⌘K, or Ctrl+K on Windows) from anywhere.", img: "/marketing/search/palette.jpg", w: 2880, h: 1800, alt: "Search showing pages, people, deals and items", href: "/features/copilot", span: "lg:col-span-2", pos: "50% 20%" },
  { title: "Phone-perfect, element by element", body: "Change a heading's size, colour or spacing for phones only — the desktop stays as it is.", img: "/marketing/builder/phone-styles.jpg", w: 2880, h: 1800, alt: "Phone-only styles for a heading in the builder", href: "/features/website-builder", span: "lg:col-span-3", pos: "60% 25%" },
  { title: "Set up for your business in minutes", body: "Tell us what you do; we recommend the right modules and explain why. Switch anything off.", img: "/marketing/onboarding/plan.jpg", w: 2880, h: 1800, alt: "The onboarding plan with recommended modules", href: "/features/launch", span: "lg:col-span-3", pos: "50% 25%" },
];

const TRUST = [
  { icon: Fingerprint, title: "Two-step sign-in", body: "Authenticator codes for everyone; a workspace can require them. SSO and SCIM for larger teams." },
  { icon: UserCog, title: "Roles & permissions", body: "Seven roles plus your own, limited to modules, companies and branches." },
  { icon: ScrollText, title: "Audit log", body: "Every important change, sign-in and export is recorded with who and when." },
  { icon: KeyRound, title: "Encrypted secrets", body: "Payment and integration keys are encrypted at rest and never shown again." },
  { icon: FileLock2, title: "Your data, exportable", body: "Export any list as CSV or Excel, or the whole workspace, whenever you like." },
  { icon: ShieldCheck, title: "Locked-down sites", body: "Published sites run no third-party scripts and send strict security headers." },
];

export default async function Landing() {
  const [program, session] = await Promise.all([publicProgram(), getPageSession()]);
  const origin = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <>
      <SiteJsonLd />
      {/* Phones open on a swipeable intro instead of the long page. */}
      <MobileIntro signedIn={!!session} />
      <HomeHero />
      <IntelligenceHighlight />
      <WorkdayCards />
      <WorkdaySection />
      <NotesSpotlight />
      <DocumentsSpotlight />

      {/* ── Three things, one platform ── */}
      <section className="relative py-20 sm:py-28">
        <div className={W}>
          <Reveal className="mx-auto max-w-4xl text-center">
            <Eyebrow>One platform</Eyebrow>
            <h2 className={clsx(H2, "mt-4")}><FitLine>Create your website, store and software <Mark tone="lavender">in minutes</Mark>.</FitLine></h2>
            <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-fg/55">Start with one, add the others when you&apos;re ready. They share your customers, products, stock and money — so nothing is typed twice.</p>
          </Reveal>
          <div className={clsx("mt-14", SLIDER, "lg:grid-cols-3")}>
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={i * 90} className={SLIDE}>
                <Link href={p.href} className={clsx("mk-bento group flex h-full flex-col overflow-hidden rounded-[28px]", `tint-${p.tone}`)}>
                  <div className="p-7 pb-5">
                    <h3 className="text-[22px] font-medium tracking-[-0.02em]">{p.title}</h3>
                    <ul className="mt-4 space-y-2">
                      {p.points.map((x) => (
                        <li key={x} className="flex gap-2.5 text-[14.5px] text-fg/65"><Check className="mt-0.5 size-4 shrink-0 text-[var(--p-mint-ink)]" />{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="relative mt-auto ml-7 overflow-hidden rounded-tl-[14px] shadow-[0_-10px_40px_-20px_rgb(0_0_0/0.25)] ring-1 ring-fg/[0.06]">
                    <Image src={p.img} alt={p.alt} width={2880} height={1800} sizes="(min-width: 1024px) 32vw, 90vw" className="block h-56 w-full object-cover object-left-top" />
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── What makes it different ── */}
      <section id="ideas" className="relative overflow-x-clip py-20 sm:py-28">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-24 -z-10 mx-auto h-[520px] max-w-6xl rounded-full opacity-60 blur-3xl" style={{ background: "radial-gradient(closest-side, var(--p-lavender), transparent), radial-gradient(40% 50% at 80% 30%, var(--p-sky), transparent)" }} />
        <div className={W}>
          <Reveal className="mx-auto max-w-3xl text-center">
            <Eyebrow>What makes it different</Eyebrow>
            <h2 className="mt-3 text-[clamp(2rem,4.6vw,3.4rem)] leading-[1.03] font-[380] tracking-[-0.045em] text-balance">
              Ideas that make Cloudesk <Mark tone="lavender">different</Mark>.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-[16.5px] leading-relaxed text-fg/55">Things we built because no other tool did them together — each one working in the app today.</p>
          </Reveal>
          <Reveal className="mt-10" delay={80}>
            <Innovations />
          </Reveal>
        </div>
      </section>

      {/* ── What's new ── */}
      <section id="new" className="relative py-20 sm:py-28">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full" style={{ background: "radial-gradient(55% 45% at 50% 0%, color-mix(in srgb, var(--tint-lavender) 55%, transparent), transparent 70%)" }} />
        <div className={W}>
          <Reveal className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-3xl">
              <Eyebrow>What&apos;s new</Eyebrow>
              <h2 className={clsx(H2, "mt-4")}><FitLine>Built for speed. <Mark tone="peach">Made for detail.</Mark></FitLine></h2>
            </div>
            <p className="max-w-md text-[16px] leading-relaxed text-fg/55">Real screens from the app, using a demo business. No mock-ups.</p>
          </Reveal>
          <div className={clsx("mt-12", SLIDER, "lg:grid-cols-6")}>
            {NEW.map((n, i) => (
              <Reveal key={n.title} delay={(i % 3) * 80} className={clsx(SLIDE, n.span)}>
                <Link href={n.href} className="mk-bento group flex h-full flex-col overflow-hidden rounded-[26px]">
                  <div className="p-6 pb-4 sm:p-7 sm:pb-5">
                    <h3 className="flex items-start justify-between gap-3 text-[19px] leading-snug font-medium tracking-[-0.02em]">{n.title}<ArrowUpRight className="mt-1 size-4 shrink-0 text-fg/30 transition-colors group-hover:text-fg" /></h3>
                    <p className="mt-2 text-[14.5px] leading-relaxed text-fg/55">{n.body}</p>
                  </div>
                  <div className="relative mt-auto h-56 overflow-hidden border-t border-fg/[0.06] bg-fg/[0.02] sm:h-64">
                    <Image src={n.img} alt={n.alt} width={n.w} height={n.h} sizes="(min-width: 1024px) 50vw, 95vw" className="absolute inset-0 size-full object-cover" style={{ objectPosition: n.pos ?? "50% 0%" }} />
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── The whole suite ── */}
      <section id="suite" className="relative py-20 sm:py-28">
        <div className={W}>
          <Reveal className="mx-auto max-w-4xl text-center">
            <Eyebrow>The suite</Eyebrow>
            <h2 className={clsx(H2, "mt-4")}><FitLine>One suite. <Mark tone="mint">Switch on what you need.</Mark></FitLine></h2>
            <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-fg/55">Each one is complete on its own and connected to the rest — your sidebar only shows what you use.</p>
          </Reveal>
          <div className={clsx("mt-14", SLIDER, "lg:grid-cols-3 xl:grid-cols-5")}>
            {PRODUCT_GROUPS.map((g, gi) => (
              <Reveal key={g.id} delay={gi * 70} className={SLIDE}>
                <div className="mk-bento h-full rounded-[24px] p-5">
                  <p className="text-[15px] font-semibold">{g.title}</p>
                  <p className="text-[12.5px] text-fg/45">{g.line}</p>
                  <ul className="mt-4 space-y-0.5">
                    {groupFeatures(g).map((f) => {
                      const Icon = f.icon;
                      return (
                        <li key={f.slug}>
                          <Link href={`/features/${f.slug}`} className={clsx("group/r flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-[13.5px] text-fg/75 transition-colors hover:bg-fg/[0.04] hover:text-fg", `tint-${f.tint}`)}>
                            <span className="tint-chip grid size-7 shrink-0 place-items-center rounded-[8px]"><Icon className="size-3.5" /></span>
                            <span className="flex-1 leading-tight">{shortName(f.name)}</span>
                            <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover/r:opacity-60" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── On your phone ── */}
      <section className="relative overflow-x-clip py-16 sm:py-24">
        <div className={W}>
          <Reveal className="mx-auto max-w-5xl text-center">
            <Eyebrow>On your phone</Eyebrow>
            <h2 className={clsx(H2, "mt-4")}><FitLine>Run it from <Mark tone="sky">your pocket</Mark>.</FitLine></h2>
            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-fg/55">Take orders, ring up sales, send invoices and check today&apos;s bookings — every screen works on a phone.</p>
          </Reveal>
          <Reveal className="mt-12 sm:mt-16" delay={100}>
            <PhoneDeck />
          </Reveal>
        </div>
      </section>

      <HorecaSpotlight />
      <Businesses />
      <Integrations />

      {/* ── Security & trust ── */}
      <section id="trust" className={clsx(W, "py-16 sm:py-24")}>
        <div className="mk-deep mk-trust relative isolate overflow-hidden rounded-[32px] px-5 py-12 sm:rounded-[36px] sm:px-10 sm:py-16 lg:px-14 lg:py-20">
          <div aria-hidden className="mk-trust-grid absolute inset-0 -z-10" />
          <div aria-hidden className="mk-trust-rings absolute -top-40 -right-40 -z-10 size-[520px] sm:-top-48 sm:-right-24 sm:size-[640px] lg:-top-72 lg:-right-56">
            <ShieldCheck className="absolute top-1/2 left-1/2 size-24 -translate-1/2 text-white/[0.06]" strokeWidth={1} />
          </div>
          <Reveal className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-[12.5px] font-medium text-[#c7d2fe] ring-1 ring-white/[0.1]">
                <ShieldCheck className="size-3.5" /> Security & trust
              </p>
              <h2 className="mt-5 max-w-2xl text-[clamp(1.85rem,4vw,3.1rem)] leading-[1.06] font-[380] tracking-[-0.04em] text-balance">
                Built like the business software <span className="text-white/50">big companies use.</span>
              </h2>
            </div>
            <div className="min-w-0 lg:pb-1.5">
              <p className="max-w-md text-[16px] leading-relaxed text-white/65">Your customers&apos; details, your money and your team&apos;s work deserve care. These are on from day one.</p>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href="/start" className="hero-cta inline-flex h-11 items-center gap-2 rounded-full px-6 text-[15px] font-semibold">Start free <ArrowRight className="size-4" /></Link>
                <Link href="/security" className="group inline-flex items-center gap-1.5 text-[14.5px] font-medium text-white/75 transition-colors hover:text-white">
                  How we protect your data <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </Reveal>
          <ul className="mt-12 grid gap-3 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map((t, i) => {
              const Icon = t.icon;
              return (
                <Reveal as="li" key={t.title} delay={i * 60} className="mk-trust-card rounded-[20px] p-5 sm:p-6">
                    <span className="mk-trust-icon grid size-10 place-items-center rounded-[12px]"><Icon className="size-[18px]" /></span>
                    <p className="mt-5 text-[15.5px] font-semibold tracking-[-0.01em]">{t.title}</p>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-white/60">{t.body}</p>
                </Reveal>
              );
            })}
          </ul>
        </div>
      </section>

      <PartnersSpotlight program={program} origin={origin} />
      <Faq />

      {/* ── Final CTA ── */}
      <section className={clsx(W, "pt-16")}>
        <Reveal>
          <div className="mk-hero mk-deep mk-deep-sea relative isolate overflow-hidden rounded-[40px] px-6 py-20 text-center sm:py-28">
            <div aria-hidden className="mk-hero-mesh absolute inset-0 -z-10" />
            <div aria-hidden className="mk-hero-grid absolute inset-0 -z-10" />
            <h2 className="mx-auto max-w-4xl text-[clamp(2.2rem,5vw,4.4rem)] leading-[1] font-[380] tracking-[-0.05em] text-balance">Your website, store and software — <span className="mk-hero-gradient">live today.</span></h2>
            <p className="mx-auto mt-5 max-w-xl text-[17px] text-white/65">Start free. Describe your business, and see it set up while you watch.</p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/start" className="hero-cta inline-flex h-[52px] items-center gap-2 rounded-full px-8 text-[15px] font-semibold">Start free <ArrowRight className="size-4" /></Link>
              <Link href="/features" className="hero-cta-glass inline-flex h-[52px] items-center rounded-full px-7 text-[15px] font-medium">Explore all features</Link>
            </div>
            <p className="mt-6 inline-flex items-center gap-1.5 text-[13px] text-white/50"><Lock className="size-3.5" /> No card needed · cancel any time · export your data whenever you like</p>
          </div>
        </Reveal>
      </section>
    </>
  );
}
