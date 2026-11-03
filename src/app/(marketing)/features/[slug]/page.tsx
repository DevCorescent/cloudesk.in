import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { featureBySlug, FEATURES } from "@/components/marketing/features";
import { HighlightExplorer } from "@/components/marketing/highlight-explorer";
import { MailConnections, RecurringWeek } from "@/components/marketing/mail-connections";
import { DarkBand, DarkHero } from "@/components/marketing/dark-hero";
import { Mark, Reveal } from "@/components/marketing/interactive";
import { PhoneFrame } from "@/components/marketing/phone-deck";
import { PHONE_SHOTS } from "@/components/marketing/phone-shots";
import { SCENES } from "@/components/marketing/scenes";
import { SHOWCASES } from "@/components/marketing/showcases";
import { StackTour, TiltShot } from "@/components/marketing/shot-tour";
import { StackHero } from "@/components/marketing/stack-hero";
import { TemplateGallery } from "@/components/marketing/template-gallery";

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: PageProps<"/features/[slug]">): Promise<Metadata> {
  const f = featureBySlug((await params).slug);
  return f ? { title: `${f.name} — Cloudesk`, description: f.lede } : {};
}

export default async function FeaturePage({ params }: PageProps<"/features/[slug]">) {
  const f = featureBySlug((await params).slug);
  if (!f) notFound();
  const Scene = SCENES[f.slug];
  const Icon = f.icon;
  const idx = FEATURES.indexOf(f);
  const next = FEATURES[(idx + 1) % FEATURES.length];
  const show = SHOWCASES[f.slug];
  const phone = PHONE_SHOTS[f.slug];
  const title = (
    <>
      {f.title.split(f.mark)[0]}
      <Mark tone={f.tint} delay={600}>
        {f.mark}
      </Mark>
      {f.title.split(f.mark).slice(1).join(f.mark)}
    </>
  );
  return (
    <div className={`tint-${f.tint}`}>
      {show ? (
        /* Hero with a real screenshot that straightens as you scroll */
        <>
          <DarkHero className="pt-8 pb-6 lg:pt-14">
            <div className="mx-auto max-w-3xl text-center">
              <Link href="/features" className="p-in inline-flex items-center gap-1 text-[13px] text-fg/50 hover:text-fg">
                <ArrowLeft className="size-3.5" /> All features
              </Link>
              <p className="p-in mt-5" style={{ animationDelay: "60ms" }}>
                <span className="tint-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold">
                  <Icon className="size-3.5" /> {f.name}
                </span>
              </p>
              <h1 className="p-in mt-5 text-[clamp(2.3rem,5.6vw,4.4rem)] leading-[1] font-[380] tracking-[-0.045em] text-balance" style={{ animationDelay: "120ms" }}>
                {title}
              </h1>
              <p className="p-in mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-fg/60" style={{ animationDelay: "200ms" }}>
                {f.lede}
              </p>
              <div className="p-in mt-8 flex flex-col justify-center gap-3 sm:flex-row" style={{ animationDelay: "280ms" }}>
                <Link href="/start" className="p-cta lx-sheen inline-flex items-center justify-center gap-2 px-7">
                  Try it free <ArrowRight className="size-4" />
                </Link>
                <a href="#tour" className="p-glass inline-flex h-[50px] items-center justify-center rounded-full px-6 text-[15px] font-semibold">
                  Take the tour
                </a>
              </div>
            </div>
          </DarkHero>
          <section className="relative z-10 mx-auto -mt-20 w-full max-w-[1600px] overflow-x-clip px-5 pb-10 sm:-mt-28 sm:px-8 lg:px-14 xl:px-20">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-[30%] -z-10 mx-auto h-[60%] max-w-5xl rounded-full opacity-70 blur-3xl"
              style={{
                background: "radial-gradient(closest-side, var(--t), transparent)",
              }}
            />
          <div className={`p-in mx-auto max-w-[1240px] ${phone ? "hidden sm:block" : ""}`} style={{ animationDelay: "340ms" }}>
            {show.hero.stack ? <StackHero cards={show.hero.stack} /> : <TiltShot shot={show.hero.shot} detailLeft={show.hero.left} detailRight={show.hero.right} leftWidth={show.hero.leftWidth} />}
          </div>
          {/* On a phone: the feature as it looks on a phone. */}
          {phone && (
            <div className="p-in mx-auto w-[min(74vw,300px)] sm:hidden" style={{ animationDelay: "340ms" }}>
              <PhoneFrame src={phone.src} alt={phone.alt} priority />
            </div>
          )}
          <p className="mt-14 text-center text-[12.5px] text-fg/40 sm:mt-16">{show.note}</p>
          </section>
        </>
      ) : (
        <DarkBand>
        <section className="mx-auto grid grid-cols-1 w-full max-w-[1600px] items-center gap-12 px-5 pt-8 pb-16 sm:px-8 lg:px-14 xl:px-20 lg:grid-cols-[1fr_1fr] lg:pt-14">
          <div>
            <Link href="/features" className="p-in inline-flex items-center gap-1 text-[13px] text-fg/50 hover:text-fg">
              <ArrowLeft className="size-3.5" /> All features
            </Link>
            <p className="p-in mt-5" style={{ animationDelay: "60ms" }}>
              <span className="tint-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold">
                <Icon className="size-3.5" /> {f.name}
              </span>
            </p>
            <h1 className="p-in mt-5 text-[clamp(2.3rem,5.6vw,4rem)] leading-[1] font-[380] tracking-[-0.045em] text-balance" style={{ animationDelay: "120ms" }}>
              {title}
            </h1>
            <p className="p-in mt-5 max-w-xl text-[17px] leading-relaxed text-fg/60" style={{ animationDelay: "200ms" }}>
              {f.lede}
            </p>
            <div className="p-in mt-8 flex flex-wrap gap-3" style={{ animationDelay: "280ms" }}>
              <Link href="/start" className="p-cta lx-sheen inline-flex items-center gap-2 px-7">
                Try it free <ArrowRight className="size-4" />
              </Link>
              <a href="#how" className="p-glass inline-flex h-[50px] items-center rounded-full px-6 text-[15px] font-semibold">
                How it works
              </a>
            </div>
          </div>
          <div className="p-in" style={{ animationDelay: "160ms" }}>
            <div className="relative">
              <span aria-hidden className="absolute inset-[8%] -z-10 rounded-full opacity-80 blur-3xl" style={{ background: "var(--t)" }} />
              {Scene && <Scene />}
            </div>
          </div>
        </section>
        </DarkBand>
      )}

      {/* Steps */}
      <section id="how" className="mx-auto w-full max-w-[1600px] scroll-mt-20 px-5 py-16 sm:px-8 lg:px-14 xl:px-20">
        <Reveal className="text-center">
          <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">How it works</p>
          <h2 className="mt-3 text-[clamp(1.9rem,4.2vw,2.8rem)] font-[380] tracking-[-0.04em]">Three steps, no surprises</h2>
        </Reveal>
        <ol className="relative mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {f.steps.map((s, i) => (
            <Reveal key={s.title} as="li" delay={i * 120}>
              <div className="tint-card h-full rounded-[24px] p-6">
                <span className="tint-chip grid size-10 place-items-center rounded-full text-[15px] font-semibold">{i + 1}</span>
                <h3 className="mt-4 text-[17px] font-medium tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-fg/60">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      {show ? (
        <section id="tour" className="mx-auto w-full max-w-[1600px] scroll-mt-16 px-5 py-16 sm:px-8 lg:px-14 xl:px-20">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">The tour</p>
            <h2 className="mt-3 text-[clamp(1.9rem,4.2vw,3rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">
              Every tool, <Mark tone={f.tint}>up close</Mark>.
            </h2>
          </Reveal>
          <div className="mt-12 lg:mt-16">
            <StackTour chapters={show.chapters} />
          </div>
        </section>
      ) : null}

      {f.slug === "mail" && (
        <>
          {/* Mail and the rest of Cloudesk: one email, everywhere it needs to go */}
          <section id="connected" className="mx-auto w-full max-w-[1400px] scroll-mt-16 px-5 py-16 sm:px-8 lg:px-14 xl:px-20">
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Connected to everything</p>
              <h2 className="mt-3 text-[clamp(1.9rem,4.2vw,3rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">
                One email, <Mark tone="sky">everywhere it needs to go</Mark>.
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-[16px] leading-relaxed text-fg/55">Save it to Notes, put it in your calendar, make it a task or hand it to your team in Chat — in one click, with the details filled in from the email. Everything it becomes links back to it.</p>
            </Reveal>
            <Reveal className="mt-12" delay={80}>
              <MailConnections />
            </Reveal>
          </section>
          <section id="recurring" className="mx-auto w-full max-w-[1400px] scroll-mt-16 px-5 py-16 sm:px-8 lg:px-14 xl:px-20">
            <Reveal>
              <RecurringWeek />
            </Reveal>
          </section>
        </>
      )}

      {/* In detail: an interactive list of highlights */}
      <section className="mx-auto w-full max-w-[1600px] px-5 py-16 sm:px-8 lg:px-14 xl:px-20">
        <Reveal className="mx-auto max-w-5xl text-center">
          <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">In detail</p>
          <h2 className="mt-3 text-[clamp(1.9rem,4.2vw,2.8rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">
            What you get with <Mark tone={f.tint}>{f.name}</Mark>
          </h2>
        </Reveal>
        <Reveal className="mt-12" delay={80}>
          <HighlightExplorer items={f.highlights} />
        </Reveal>
      </section>

      {show?.templates && (
        <section id="templates" className="mx-auto w-full max-w-[1600px] scroll-mt-16 px-5 py-16 sm:px-8 lg:px-14 xl:px-20">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Store templates</p>
            <h2 className="mt-3 text-[clamp(1.9rem,4.2vw,3rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">Stores that look <Mark tone={f.tint}>expensive</Mark> on day one.</h2>
            <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-fg/55">Each one is a real storefront made from the template with its sample products. Hover a card to scroll the whole page.</p>
          </Reveal>
          <div className="mt-12">
            <TemplateGallery />
          </div>
        </section>
      )}

      {/* Good to know + FAQ */}
      <section className="mx-auto grid grid-cols-1 w-full max-w-[1600px] gap-6 px-5 py-16 sm:px-8 lg:px-14 xl:px-20 lg:grid-cols-[1fr_1.4fr]">
        <Reveal>
          <div className="tint-card h-full rounded-[26px] p-7">
            <span className="tint-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold">
              <Info className="size-3.5" /> Good to know
            </span>
            <p className="mt-4 text-[14px] text-fg/60">We&apos;d rather be upfront than surprise you later:</p>
            <ul className="mt-3 grid gap-3">
              {f.goodToKnow.map((g) => (
                <li key={g} className="flex gap-2.5 text-[14px] leading-relaxed">
                  <span className="tint-ink mt-2 size-1.5 shrink-0 rounded-full bg-current" />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="grid gap-3">
            <h2 className="text-[22px] font-[450] tracking-[-0.02em]">Questions people ask</h2>
            {f.faqs.map((q) => (
              <details key={q.q} className="group p-glass rounded-[18px] px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold">
                  {q.q}
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg/[0.05] text-[18px] leading-none transition-transform duration-300 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-fg/60">{q.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Related */}
      <section className="mx-auto w-full max-w-[1600px] px-5 py-16 sm:px-8 lg:px-14 xl:px-20">
        <Reveal>
          <h2 className="text-[22px] font-[450] tracking-[-0.02em]">Works beautifully with</h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          {f.related.map((slug, i) => {
            const r = featureBySlug(slug)!;
            const RIcon = r.icon;
            return (
              <Reveal key={slug} delay={i * 90}>
                <Link href={`/features/${slug}`} className={clsx("tint-card mk-lift group flex h-full flex-col gap-2 rounded-[22px] p-5", `tint-${r.tint}`)}>
                  <span className="tint-chip grid size-9 place-items-center rounded-[12px]">
                    <RIcon className="size-4" />
                  </span>
                  <span className="mt-1 text-[16px] font-semibold">{r.name}</span>
                  <span className="text-[13px] leading-relaxed text-fg/60">{r.short}</span>
                  <span className="tint-ink mt-auto inline-flex items-center gap-1 pt-2 text-[13px] font-semibold">
                    Explore <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* CTA + next */}
      <section className="mx-auto w-full max-w-[1600px] px-5 pt-8 sm:px-8 lg:px-14 xl:px-20">
        <Reveal>
          <div className="fin-hero flex flex-wrap items-center justify-between gap-6 rounded-[32px] p-8 sm:p-12">
            <div>
              <h2 className="text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.05] font-[380] tracking-[-0.035em]">Give it a spin — it&apos;s free to start.</h2>
              <p className="mt-2 text-[15px] text-fg/60">
                Next up:{" "}
                <Link href={`/features/${next.slug}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                  {next.name} →
                </Link>
              </p>
            </div>
            <Link href="/start" className="p-cta lx-sheen inline-flex items-center gap-2 px-8">
              Start free <ArrowRight className="size-4" />
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
