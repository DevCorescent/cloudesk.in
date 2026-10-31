import { ArrowLeft, ArrowRight, Check, Info, Minus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { businessBySlug, BUSINESSES, signupFor } from "@/components/marketing/businesses";
import { featureBySlug } from "@/components/marketing/features";
import { Mark, Reveal } from "@/components/marketing/interactive";
import { StackTour } from "@/components/marketing/shot-tour";
import { StackHero } from "@/components/marketing/stack-hero";

const W = "mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-14 xl:px-20";

export function generateStaticParams() {
  return BUSINESSES.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: PageProps<"/for/[slug]">): Promise<Metadata> {
  const b = businessBySlug((await params).slug);
  return b ? { title: `Cloudesk for ${b.name.toLowerCase()}`, description: b.lede } : {};
}

export default async function BusinessPage({ params }: PageProps<"/for/[slug]">) {
  const b = businessBySlug((await params).slug);
  if (!b) notFound();
  const Icon = b.icon;
  const idx = BUSINESSES.indexOf(b);
  const others = BUSINESSES.filter((x) => x.slug !== b.slug);
  const next = BUSINESSES[(idx + 1) % BUSINESSES.length];
  const [before, after] = [b.title.split(b.mark)[0], b.title.split(b.mark).slice(1).join(b.mark)];
  return (
    <div className={`tint-${b.tint}`}>
      {/* Hero: who it's for, then the real screens stacked */}
      <section className={clsx(W, "relative overflow-x-clip pt-8 pb-10 lg:pt-14")}>
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-[38%] -z-10 mx-auto h-[60%] max-w-5xl rounded-full opacity-70 blur-3xl" style={{ background: "radial-gradient(closest-side, var(--t), transparent)" }} />
        <div className="mx-auto max-w-3xl text-center">
          <Link href="/for" className="p-in inline-flex items-center gap-1 text-[13px] text-fg/50 hover:text-fg">
            <ArrowLeft className="size-3.5" /> All businesses
          </Link>
          <p className="p-in mt-5" style={{ animationDelay: "60ms" }}>
            <span className="tint-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold">
              <Icon className="size-3.5" /> Cloudesk for {b.name.toLowerCase()}
            </span>
          </p>
          <h1 className="p-in mt-5 text-[clamp(2.3rem,5.6vw,4.4rem)] leading-[1] font-[380] tracking-[-0.045em] text-balance" style={{ animationDelay: "120ms" }}>
            {before}
            <Mark tone={b.tint} delay={600}>
              {b.mark}
            </Mark>
            {after}
          </h1>
          <p className="p-in mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-fg/60" style={{ animationDelay: "200ms" }}>
            {b.lede}
          </p>
          <div className="p-in mt-8 flex flex-col justify-center gap-3 sm:flex-row" style={{ animationDelay: "280ms" }}>
            <Link href={signupFor(b)} className="p-cta lx-sheen inline-flex items-center justify-center gap-2 px-7">
              Start free as a {b.noun} <ArrowRight className="size-4" />
            </Link>
            <a href="#day" className="p-glass inline-flex h-[50px] items-center justify-center rounded-full px-6 text-[15px] font-semibold">
              See a day with Cloudesk
            </a>
          </div>
        </div>
        <div className="p-in mx-auto mt-12 max-w-[1240px] sm:mt-16" style={{ animationDelay: "340ms" }}>
          <StackHero cards={b.stack} />
        </div>
        <p className="mt-14 text-center text-[12.5px] text-fg/40 sm:mt-16">Real screenshots of Cloudesk, from demo businesses.</p>
      </section>

      {/* What changes */}
      <section className={clsx(W, "py-16")}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">What changes</p>
          <h2 className="mt-3 text-[clamp(1.9rem,4.2vw,3rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">
            Less juggling. <Mark tone={b.tint}>More running the place.</Mark>
          </h2>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-5xl gap-3">
          {b.shifts.map((x, i) => (
            <Reveal key={x.before} delay={i * 110}>
              <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1.15fr]">
                <div className="flex items-center gap-3 rounded-[22px] bg-fg/[0.035] px-5 py-4 text-[15px] text-fg/50">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg/[0.06]">
                    <Minus className="size-3.5" />
                  </span>
                  <span className="line-through decoration-fg/25">{x.before}</span>
                </div>
                <span aria-hidden className="hidden place-items-center md:grid">
                  <ArrowRight className="tint-ink size-5" />
                </span>
                <div className="tint-card flex items-center gap-3 rounded-[22px] px-5 py-4 text-[15px] font-medium">
                  <span className="tint-chip grid size-7 shrink-0 place-items-center rounded-full">
                    <Check className="size-3.5" />
                  </span>
                  {x.after}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* A day with Cloudesk */}
      <section id="day" className={clsx(W, "scroll-mt-16 py-16")}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">A day with Cloudesk</p>
          <h2 className="mt-3 text-[clamp(1.9rem,4.2vw,3rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">
            How a {b.noun} <Mark tone={b.tint}>actually uses it</Mark>.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-fg/55">Every screen below is the real app.</p>
        </Reveal>
        <div className="mt-12 lg:mt-16">
          <StackTour chapters={b.day} />
        </div>
      </section>

      {/* The toolkit */}
      <section className={clsx(W, "py-16")}>
        <Reveal className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Your toolkit</p>
            <h2 className="mt-3 text-[clamp(1.7rem,3.6vw,2.5rem)] leading-[1.05] font-[380] tracking-[-0.04em]">Switched on for you at sign-up.</h2>
          </div>
          <p className="max-w-sm text-[14.5px] text-fg/55">Pick “{b.name}” when you sign up and your dashboard starts with exactly these. Add or remove any later.</p>
        </Reveal>
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {b.toolkit.map((slug, i) => {
            const f = featureBySlug(slug);
            if (!f) return null;
            const FIcon = f.icon;
            return (
              <Reveal key={slug} delay={(i % 3) * 80}>
                <Link href={`/features/${slug}`} className={clsx("tint-card mk-lift group flex h-full items-start gap-4 rounded-[22px] p-5", `tint-${f.tint}`)}>
                  <span className="tint-chip grid size-11 shrink-0 place-items-center rounded-[14px] transition-transform duration-500 group-hover:-rotate-6">
                    <FIcon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[16px] font-semibold tracking-[-0.01em]">{f.name}</span>
                    <span className="mt-1 block text-[13.5px] leading-relaxed text-fg/60">{f.short}</span>
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* Good to know + FAQ */}
      <section className={clsx(W, "grid grid-cols-1 gap-6 py-16 lg:grid-cols-[1fr_1.4fr]")}>
        <Reveal>
          <div className="tint-card h-full rounded-[26px] p-7">
            <span className="tint-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold">
              <Info className="size-3.5" /> Good to know
            </span>
            <p className="mt-4 text-[14px] text-fg/60">We&apos;d rather be upfront than surprise you later:</p>
            <ul className="mt-3 grid gap-3">
              {b.goodToKnow.map((g) => (
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
            <h2 className="text-[22px] font-[450] tracking-[-0.02em]">Questions {b.noun === "jeweller" ? "jewellers" : "owners"} ask</h2>
            {b.faqs.map((q) => (
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

      {/* Other businesses */}
      <section className={clsx(W, "py-12")}>
        <Reveal>
          <h2 className="text-[22px] font-[450] tracking-[-0.02em]">Made for other businesses too</h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {others.map((o, i) => {
            const OIcon = o.icon;
            return (
              <Reveal key={o.slug} delay={(i % 4) * 60}>
                <Link href={`/for/${o.slug}`} className={clsx("group flex items-center gap-3 rounded-[18px] p-3 transition-colors hover:bg-fg/[0.04]", `tint-${o.tint}`)}>
                  <span className="tint-chip grid size-10 shrink-0 place-items-center rounded-[12px] transition-transform duration-500 group-hover:scale-110">
                    <OIcon className="size-[18px]" />
                  </span>
                  <span className="text-[14px] font-medium">{o.name}</span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className={clsx(W, "pt-8")}>
        <Reveal>
          <div className="fin-hero flex flex-wrap items-center justify-between gap-6 rounded-[32px] p-8 sm:p-12">
            <div>
              <h2 className="text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.05] font-[380] tracking-[-0.035em]">Set up for your {b.noun} in 90 seconds.</h2>
              <p className="mt-2 text-[15px] text-fg/60">
                Free to start. Next up:{" "}
                <Link href={`/for/${next.slug}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                  {next.name} →
                </Link>
              </p>
            </div>
            <Link href={signupFor(b)} className="p-cta lx-sheen inline-flex items-center gap-2 px-8">
              Start free <ArrowRight className="size-4" />
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
